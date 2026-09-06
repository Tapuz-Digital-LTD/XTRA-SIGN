import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { brandFor } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { InvitationEmail, ReminderEmail, SignedConfirmationEmail } from '@/server/mail/templates'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { otpSmsText } from '@/server/notifications/otp-sms'
import {
  cleanOverrides,
  DEFAULT_MESSAGES,
  EVENT_LABELS,
  EVENTS_BY_KIND,
  renderTemplate,
  resolveMessage,
  SAMPLE_VARIABLES,
  VARIABLE_CATALOG,
  type MessageEvent,
  type MessageOverrides,
  type MessageTemplate,
  type Variables,
} from '@/lib/message-template'
import type { CampaignKind } from '@/lib/campaigns'

/**
 * A campaign's messages: the system's words by default, the campaign's own
 * where it chose them. Read, saved as a whole per event, previewed with
 * sample values or a real registration, and test-sent to one address only.
 *
 * The OTP text is not here on purpose: it is system-controlled.
 */

export type MessageSettings = {
  kind: CampaignKind
  events: {
    event: MessageEvent
    label: string
    blurb: string
    channels: ('sms' | 'email')[]
    defaults: MessageTemplate
    override: Partial<MessageTemplate> | null
  }[]
  variables: typeof VARIABLE_CATALOG
}

async function ownedGroup(session: StaffSession, groupId: string) {
  const [group] = await getDb()
    .select({ id: schema.groups.id, name: schema.groups.name, campaignKind: schema.groups.campaignKind, messageOverrides: schema.groups.messageOverrides, startsAt: schema.groups.startsAt, endsAt: schema.groups.endsAt })
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.organizationId, session.organizationId), isNull(schema.groups.deletedAt)))
    .limit(1)
  return group ?? null
}

export async function getMessageSettings(session: StaffSession, groupId: string): Promise<MessageSettings | null> {
  const group = await ownedGroup(session, groupId)
  if (!group) return null
  const kind = (group.campaignKind === 'public' ? 'public' : 'signature') as CampaignKind
  const overrides = cleanOverrides(group.messageOverrides)
  return {
    kind,
    events: EVENTS_BY_KIND[kind].map((event) => ({
      event,
      label: EVENT_LABELS[event].label,
      blurb: EVENT_LABELS[event].blurb,
      channels: EVENT_LABELS[event].channels,
      defaults: DEFAULT_MESSAGES[event],
      override: overrides[event] ?? null,
    })),
    variables: VARIABLE_CATALOG,
  }
}

/** Save one event's words; `null` puts the default back. Links must always be placed. */
export async function saveMessageOverride(session: StaffSession, groupId: string, event: MessageEvent, raw: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  if (!(event in DEFAULT_MESSAGES)) return { ok: false, message: 'אירוע לא מוכר.' }
  const current = cleanOverrides(group.messageOverrides)
  const next: MessageOverrides = { ...current }
  if (raw === null) {
    delete next[event]
  } else {
    const cleaned = cleanOverrides({ [event]: raw })[event]
    if (!cleaned) {
      delete next[event]
    } else {
      const linkVar = event === 'signed_confirmation' ? null : '{{signing_link}}'
      if (linkVar && cleaned.sms && !cleaned.sms.includes(linkVar)) return { ok: false, message: `הודעת ה-SMS חייבת לכלול את ${linkVar}.` }
      next[event] = cleaned
    }
  }
  await getDb().update(schema.groups).set({ messageOverrides: next }).where(eq(schema.groups.id, group.id))
  return { ok: true }
}

async function variablesFor(session: StaffSession, group: NonNullable<Awaited<ReturnType<typeof ownedGroup>>>, leadId: string | null): Promise<Variables> {
  const [org] = await getDb().select({ name: schema.organizations.name, email: schema.organizations.email, phone: schema.organizations.phone }).from(schema.organizations).where(eq(schema.organizations.id, session.organizationId)).limit(1)
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: 'Asia/Jerusalem' }).format(d) : '')
  const base: Variables = {
    ...SAMPLE_VARIABLES,
    campaign_name: group.name,
    campaign_start: day(group.startsAt) || SAMPLE_VARIABLES.campaign_start,
    campaign_end: day(group.endsAt) || SAMPLE_VARIABLES.campaign_end,
    organization_name: org?.name ?? SAMPLE_VARIABLES.organization_name,
    organization_email: org?.email ?? '',
    organization_phone: org?.phone ?? '',
  }
  if (!leadId) return base
  const [lead] = await getDb()
    .select({ data: schema.projectLeads.data, companyName: schema.companies.name, taxId: schema.companies.taxId, contactName: schema.companies.contactName, phone: schema.companies.contactPhone, email: schema.companies.contactEmail })
    .from(schema.projectLeads)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.projectLeads.companyId))
    .where(and(eq(schema.projectLeads.id, leadId), eq(schema.projectLeads.groupId, group.id)))
    .limit(1)
  if (!lead) return base
  const d = (lead.data ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
  const signer: string = lead.contactName || str('contactName') || str('signerName') || base.signer_name || ''
  return {
    ...base,
    signer_name: signer,
    first_name: signer.split(' ')[0] ?? signer,
    last_name: signer.split(' ').slice(1).join(' '),
    contact_name: signer,
    company_name: lead.companyName || str('businessName') || base.company_name,
    company_number: lead.taxId || str('taxId') || base.company_number,
    phone: lead.phone || str('phone') || base.phone,
    email: lead.email || str('email') || base.email,
  }
}

export type MessagePreview = { sms?: { text: string; missing: string[] }; email?: { subject: string; html: string; text: string; missing: string[] } }

/** What the message would say, with sample values or a real registration's. */
export async function previewMessage(session: StaffSession, groupId: string, input: { event: MessageEvent; override?: unknown; leadId?: string | null }): Promise<MessagePreview | null> {
  const group = await ownedGroup(session, groupId)
  if (!group) return null
  const override = input.override === undefined ? cleanOverrides(group.messageOverrides)[input.event] : cleanOverrides({ [input.event]: input.override })[input.event]
  const message = resolveMessage(input.event, override)
  const vars = await variablesFor(session, group, input.leadId ?? null)
  const out: MessagePreview = {}
  const channels = EVENT_LABELS[input.event].channels
  if (channels.includes('sms') && message.sms) {
    const r = renderTemplate(message.sms, vars)
    out.sms = { text: r.text, missing: r.missing }
  }
  if (channels.includes('email') && message.email) {
    const subject = renderTemplate(message.email.subject, vars)
    const body = renderTemplate(message.email.body, vars)
    const cta = renderTemplate(message.email.cta ?? '', vars).text
    const brand = await brandFor({ organizationId: session.organizationId })
    const common = { brand, title: subject.text, body: body.text, organizationName: vars.organization_name ?? '' }
    const element =
      input.event === 'reminder'
        ? ReminderEmail({ ...common, cta: cta || 'להמשך חתימה', signingUrl: vars.signing_link ?? '', facts: [{ label: 'מסמך', value: vars.document_name ?? '' }] })
        : input.event === 'signed_confirmation'
          ? SignedConfirmationEmail({ ...common, cta: cta || 'הורדת המסמך החתום', downloadUrl: vars.signed_document_link ?? '', facts: [{ label: 'מסמך', value: vars.document_name ?? '' }, { label: 'חותם', value: vars.signer_name ?? '' }] })
          : InvitationEmail({ ...common, cta: cta || 'לצפייה וחתימה', signingUrl: vars.signing_link ?? '', facts: [{ label: 'מסמך', value: vars.document_name ?? '' }] })
    const rendered = await renderEmail(subject.text, element)
    out.email = { ...rendered, missing: [...new Set([...subject.missing, ...body.missing])] }
  }
  return out
}

/** A test copy to one phone and/or address the staff member typed — flagged as a test everywhere it lands. */
export async function sendMessageTest(session: StaffSession, groupId: string, input: { event: MessageEvent; override?: unknown; phone?: string; email?: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const preview = await previewMessage(session, groupId, input)
  if (!preview) return { ok: false, message: 'לא ניתן להכין תצוגה מקדימה.' }
  const db = getDb()
  const record = async (channel: 'sms' | 'email', recipient: string, subject: string | null, body: string, res: { ok: boolean; providerMessageId: string | null; error?: string }) =>
    db.insert(schema.messageSends).values({ organizationId: session.organizationId, groupId: group.id, channel, event: 'test', recipient, subject, body, isTest: true, ok: res.ok, error: res.ok ? null : (res.error ?? null), providerMessageId: res.providerMessageId })
  const errors: string[] = []
  let sent = 0
  if (input.phone && preview.sms) {
    const res = await new InforuSmsProvider().send({ to: input.phone, text: `[בדיקה] ${preview.sms.text}` })
    await record('sms', input.phone, null, preview.sms.text, res.ok ? res : { ...res, error: res.error })
    if (res.ok) sent++
    else errors.push(res.error)
  }
  if (input.email && preview.email) {
    const res = await new InforuEmailProvider().send({ to: input.email, subject: `[בדיקה] ${preview.email.subject}`, text: preview.email.text, html: preview.email.html })
    await record('email', input.email, preview.email.subject, preview.email.text, res.ok ? res : { ...res, error: res.error })
    if (res.ok) sent++
    else errors.push(res.error)
  }
  if (sent === 0 && errors.length === 0) return { ok: false, message: 'הזינו טלפון או אימייל לבדיקה.' }
  if (errors.length) return { ok: false, message: `שליחת הבדיקה נכשלה: ${errors.join(', ')}` }
  return { ok: true }
}

/** The OTP text as the system sends it — shown, never edited. */
export function otpSample(): string {
  return otpSmsText(process.env.SIGN_OTP_MESSAGE?.trim() || 'קוד האימות שלך ל-XTRA Sign:', '123456')
}
