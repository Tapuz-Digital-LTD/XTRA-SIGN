import { and, desc, eq, inArray } from 'drizzle-orm'
import { classifySource, type Utm } from '@/lib/campaign-events'
import { DEFAULT_MESSAGES, renderTemplate } from '@/lib/message-template'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import { AUDIT_EVENTS } from '@/server/audit'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { buildSigningUrl, mintAdditionalSigningLink, renewSigningLink, resendAgreement } from '@/server/documents/send-agreement'
import { authorizeGroup } from '@/server/groups/groups'
import { publicBaseUrl } from '@/server/http/public-url'
import { brandFor } from '@/server/mail/brand'
import { InforuEmailProvider } from '@/server/notifications/inforu'
import { signerConfirmationEmail, renderSubmission } from '@/server/notifications/campaign-mail'
import { projectNotificationSettings } from '@/server/projects/notification-settings'
import { formatDuration } from '@/lib/format-duration'

/**
 * Acting on a registration from the report, without leaving it.
 *
 * The table shows a summary; the drawer shows everything; the actions are
 * the ones that make sense for where the agreement stands — a reminder for
 * one still waiting, the signed copy for one that is done, another try for
 * one whose message failed. The server decides eligibility, one row or
 * fifty, and says who is skipped and why before anything goes out.
 */

export const REGISTRATION_ACTIONS = ['remind', 'resend', 'send_signed_copy', 'renew'] as const
export type RegistrationAction = (typeof REGISTRATION_ACTIONS)[number]

export function isRegistrationAction(value: unknown): value is RegistrationAction {
  return typeof value === 'string' && (REGISTRATION_ACTIONS as readonly string[]).includes(value)
}

const when = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jerusalem' })

// ── the drawer ────────────────────────────────────────────────────────────

export type RegistrationDetail = {
  id: string
  business: { name: string; taxId: string; contactName: string; role: string; phone: string; email: string; companyId: string | null }
  submission: { fields: { label: string; value: string }[]; registeredAt: string; source: string; utm: Utm; referrer: string | null; campaign: string | null }
  agreement: {
    id: string
    title: string
    status: string
    statusLabel: string
    sentAt: string | null
    viewedAt: string | null
    signedAt: string | null
    expiresAt: string | null
    timeToSign: string | null
  } | null
  timeline: { type: string; at: string; detail: string | null }[]
  /** What the person is allowed to do right now. */
  actions: RegistrationAction[]
  shareable: boolean
  lastDeliveryFailed: boolean
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'ממתין לחתימה', sent: 'ממתין לחתימה', viewed: 'ממתין לחתימה', signed: 'נחתם', expired: 'פג תוקף', canceled: 'בוטל', declined: 'סורב',
}

function actionsFor(status: string | null, leadStatus: string): RegistrationAction[] {
  if (leadStatus === 'failed') return []
  if (status === 'sent' || status === 'viewed') return ['remind', 'resend']
  if (status === 'signed') return ['send_signed_copy']
  if (status === 'expired') return ['renew']
  return []
}

export async function registrationDetail(session: StaffSession, projectId: string, leadId: string): Promise<RegistrationDetail | null> {
  const group = await authorizeGroup(session, projectId)
  const db = getDb()
  const [lead] = await db.select().from(schema.projectLeads).where(and(eq(schema.projectLeads.id, leadId), eq(schema.projectLeads.groupId, group.id))).limit(1)
  if (!lead) return null
  const data = (lead.data && typeof lead.data === 'object' ? lead.data : {}) as Record<string, unknown>
  const text = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '')
  const meta = (lead.meta && typeof lead.meta === 'object' ? lead.meta : {}) as Record<string, unknown>
  const utm: Utm = {}
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) if (typeof meta[key] === 'string') utm[key] = meta[key] as string
  const source = classifySource(utm, lead.referrer)

  let agreement: RegistrationDetail['agreement'] = null
  let timeline: RegistrationDetail['timeline'] = [{ type: 'registered', at: lead.createdAt.toISOString(), detail: null }]
  let lastDeliveryFailed = false
  if (lead.agreementId) {
    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, lead.agreementId)).limit(1)
    if (a) {
      const events = await db
        .select({ type: schema.auditEvents.type, createdAt: schema.auditEvents.createdAt, metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.agreementId, a.id))
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(60)
      const viewed = events.filter((e) => e.type === 'viewed').at(-1)?.createdAt ?? null
      const lastDelivery = events.find((e) => ['sms_sent', 'email_sent', 'sms_failed', 'email_failed'].includes(e.type))
      lastDeliveryFailed = Boolean(lastDelivery && lastDelivery.type.endsWith('_failed'))
      agreement = {
        id: a.id,
        title: a.title,
        status: a.status,
        statusLabel: STATUS_LABELS[a.status] ?? a.status,
        sentAt: a.sentAt?.toISOString() ?? null,
        viewedAt: viewed?.toISOString() ?? null,
        signedAt: a.completedAt?.toISOString() ?? null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        timeToSign: a.completedAt ? formatDuration(Math.max(0, Math.round((a.completedAt.getTime() - lead.createdAt.getTime()) / 1000))) : null,
      }
      timeline = [
        ...timeline,
        ...events
          .filter((e) => !['created', 'document_generated', 'field_completed', 'otp_sent', 'otp_verified', 'otp_failed'].includes(e.type))
          .map((e) => ({ type: e.type, at: e.createdAt.toISOString(), detail: detailOf(e.type, e.metadata) })),
      ].sort((x, y) => x.at.localeCompare(y.at))
    }
  }

  return {
    id: lead.id,
    business: {
      name: text('name') || text('businessName'),
      taxId: text('taxId'),
      contactName: text('contactName') || text('signatoryName'),
      role: text('custom_signatory_role') || text('signatoryRole'),
      phone: text('phone'),
      email: text('email'),
      companyId: lead.companyId,
    },
    submission: {
      fields: renderSubmission(lead.data, lead.formSnapshot),
      registeredAt: lead.createdAt.toISOString(),
      source: source.medium ? `${source.label} / ${source.medium}` : source.label,
      utm,
      referrer: lead.referrer,
      campaign: typeof meta.utm_campaign === 'string' ? (meta.utm_campaign as string) : null,
    },
    agreement,
    timeline,
    actions: actionsFor(agreement?.status ?? null, lead.status),
    shareable: Boolean(agreement && ['sent', 'viewed', 'signed'].includes(agreement.status)),
    lastDeliveryFailed,
  }
}

function detailOf(type: string, metadata: unknown): string | null {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>
  if (type === 'reminder_sent' && Array.isArray(m.channels)) return (m.channels as string[]).map((c) => (c === 'sms' ? 'SMS' : 'אימייל')).join(' + ')
  if ((type === 'email_failed' || type === 'sms_failed') && typeof m.error === 'string') return m.error.replace(/^not_sent:/, '')
  if (type === 'email_sent' && m.purpose === 'signed_copy') return 'עותק חתום לחותם'
  return null
}

// ── one row or many ───────────────────────────────────────────────────────

export type ActionPlan = {
  action: RegistrationAction
  eligible: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
  /** "התזכורת תישלח ל-12 נמענים. 3 שכבר חתמו לא יקבלו הודעה." */
  summary: string
}

const ACTION_LABELS: Record<RegistrationAction, string> = { remind: 'התזכורת', resend: 'ההודעה', send_signed_copy: 'העותק החתום', renew: 'הקישור המחודש' }

export async function planRegistrationActions(session: StaffSession, projectId: string, ids: string[], action: RegistrationAction): Promise<ActionPlan> {
  const group = await authorizeGroup(session, projectId)
  const rows = await getDb()
    .select({ id: schema.projectLeads.id, status: schema.projectLeads.status, data: schema.projectLeads.data, agreementId: schema.projectLeads.agreementId, agreementStatus: schema.agreements.status })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .where(and(eq(schema.projectLeads.groupId, group.id), inArray(schema.projectLeads.id, ids)))
  const eligible: ActionPlan['eligible'] = []
  const skipped: ActionPlan['skipped'] = []
  for (const r of rows) {
    const name = ((r.data as Record<string, unknown> | null)?.name as string) ?? ((r.data as Record<string, unknown> | null)?.businessName as string) ?? ''
    const allowed = actionsFor(r.agreementStatus ?? null, r.status)
    if (allowed.includes(action)) eligible.push({ id: r.id, name })
    else skipped.push({ id: r.id, name, reason: r.agreementStatus === 'signed' ? 'כבר חתם' : !r.agreementId ? 'אין הסכם' : STATUS_LABELS[r.agreementStatus ?? ''] ?? 'לא רלוונטי' })
  }
  const bySigned = skipped.filter((s) => s.reason === 'כבר חתם').length
  const others = skipped.length - bySigned
  const parts = [`${ACTION_LABELS[action]} ${action === 'send_signed_copy' ? 'יישלח' : 'תישלח'} ל-${eligible.length} נמענים.`]
  if (bySigned > 0) parts.push(`${bySigned} שכבר חתמו לא יקבלו הודעה.`)
  if (others > 0) parts.push(`${others} אינם רלוונטיים לפעולה הזו.`)
  return { action, eligible, skipped, summary: parts.join(' ') }
}

export type ActionResult = { sent: { id: string }[]; failed: { id: string; message: string }[]; skipped: ActionPlan['skipped'] }

export async function runRegistrationActions(session: StaffSession, projectId: string, ids: string[], action: RegistrationAction, channels: ('sms' | 'email')[]): Promise<ActionResult> {
  const plan = await planRegistrationActions(session, projectId, ids, action)
  const db = getDb()
  const sent: ActionResult['sent'] = []
  const failed: ActionResult['failed'] = []
  for (const row of plan.eligible) {
    const [lead] = await db.select({ agreementId: schema.projectLeads.agreementId }).from(schema.projectLeads).where(eq(schema.projectLeads.id, row.id)).limit(1)
    if (!lead?.agreementId) continue
    try {
      if (action === 'send_signed_copy') {
        const result = await sendSignedCopy(session, lead.agreementId)
        if (result.ok) sent.push({ id: row.id })
        else failed.push({ id: row.id, message: result.message })
        continue
      }
      const chosen = channels.length ? channels : (['sms', 'email'] as const)
      if (action === 'renew') {
        const renewed = await renewSigningLink({ session, agreementId: lead.agreementId, channels: [...chosen] })
        if (renewed.ok) sent.push({ id: row.id })
        else failed.push({ id: row.id, message: renewed.message ?? 'החידוש נכשל.' })
        continue
      }
      const result = await resendAgreement({ session, agreementId: lead.agreementId, channels: [...chosen], kind: action === 'remind' ? 'reminder' : 'resend' })
      if (result.ok) sent.push({ id: row.id })
      else failed.push({ id: row.id, message: result.message ?? 'השליחה נכשלה.' })
    } catch (error) {
      failed.push({ id: row.id, message: error instanceof Error ? error.message : 'השליחה נכשלה.' })
    }
  }
  return { sent, failed, skipped: plan.skipped }
}

/** The signer's confirmation once more, with a fresh scoped download link. */
async function sendSignedCopy(session: StaffSession, agreementId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getDb()
  const [a] = await db
    .select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, completedAt: schema.agreements.completedAt, organizationId: schema.agreements.organizationId, orgName: schema.organizations.name, mergeSnapshot: schema.agreements.mergeSnapshot, companyName: schema.companies.name })
    .from(schema.agreements)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.agreements.organizationId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(and(eq(schema.agreements.id, agreementId), eq(schema.agreements.organizationId, session.organizationId)))
    .limit(1)
  if (!a || a.status !== 'signed') return { ok: false, message: 'ההסכם עדיין לא נחתם.' }
  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, a.id)).limit(1)
  if (!recipient?.email) return { ok: false, message: 'לחותם אין כתובת אימייל.' }
  const origin = (a.mergeSnapshot as { selfService?: { skin?: string; projectId?: string } } | null)?.selfService
  const minted = await mintAdditionalSigningLink(recipient.id, new Date(Date.now() + 30 * 86_400_000))
  const settings = origin?.projectId ? await projectNotificationSettings(origin.projectId) : null
  const mail = await signerConfirmationEmail({
    vars: {
      document_name: a.title,
      signer_name: recipient.name,
      signed_document_link: `${publicBaseUrl()}/api/sign/${minted.token}/download`,
      organization_name: a.orgName,
      signed_at: a.completedAt ? when.format(a.completedAt) : '',
      company_name: a.companyName,
    },
    brand: await brandFor({ organizationId: a.organizationId, skin: origin?.skin ?? null }),
    note: settings?.signerCopy.note ?? null,
  })
  const result = await new InforuEmailProvider().send({ to: recipient.email, subject: mail.subject, text: mail.text, html: mail.html, recipientName: recipient.name, replyTo: settings?.signerCopy.replyTo ?? undefined, fromName: settings?.signerCopy.senderName ?? undefined })
  await db.insert(schema.auditEvents).values({
    agreementId: a.id,
    recipientId: recipient.id,
    type: result.ok ? AUDIT_EVENTS.EMAIL_SENT : AUDIT_EVENTS.EMAIL_FAILED,
    actor: session.email,
    metadata: { purpose: 'signed_copy', ...(result.ok ? {} : { error: result.error }) },
  })
  return result.ok ? { ok: true } : { ok: false, message: 'שליחת האימייל נכשלה.' }
}

// ── a link to hand over by hand ───────────────────────────────────────────

export type ShareLink = { ok: true; url: string; text: string; whatsappUrl: string } | { ok: false; message: string }

/**
 * A fresh personal link — to sign, or to download the signed copy — with
 * the message written from the campaign's template. Minting a new token
 * keeps every earlier link the person got working; the share is recorded
 * as the share sheet opening, never as a delivery.
 */
export async function mintShareLink(session: StaffSession, projectId: string, leadId: string, via: 'whatsapp' | 'copy'): Promise<ShareLink> {
  const group = await authorizeGroup(session, projectId)
  const db = getDb()
  const [lead] = await db.select({ agreementId: schema.projectLeads.agreementId, data: schema.projectLeads.data }).from(schema.projectLeads).where(and(eq(schema.projectLeads.id, leadId), eq(schema.projectLeads.groupId, group.id))).limit(1)
  if (!lead?.agreementId) return { ok: false, message: 'להרשמה הזו אין הסכם.' }
  const [a] = await db.select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, expiresAt: schema.agreements.expiresAt }).from(schema.agreements).where(eq(schema.agreements.id, lead.agreementId)).limit(1)
  if (!a || !['sent', 'viewed', 'signed'].includes(a.status)) return { ok: false, message: 'אין קישור לשיתוף במצב הזה.' }
  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, a.id)).limit(1)
  if (!recipient) return { ok: false, message: 'לא נמצא חותם.' }

  const minted = await mintAdditionalSigningLink(recipient.id, a.expiresAt ?? new Date(Date.now() + 30 * 86_400_000))
  const url = a.status === 'signed' ? `${publicBaseUrl()}/api/sign/${minted.token}/download` : buildSigningUrl(minted.token)
  const text =
    a.status === 'signed'
      ? `שלום ${recipient.name}, העותק החתום של "${a.title}" זמין להורדה בקישור המאובטח: ${url}`
      : renderTemplate(DEFAULT_MESSAGES.reminder.sms!, { signer_name: recipient.name, document_name: a.title, signing_link: url }).text
  await db.insert(schema.auditEvents).values({
    agreementId: a.id,
    recipientId: recipient.id,
    type: via === 'whatsapp' ? AUDIT_EVENTS.WHATSAPP_SHARE_OPENED : AUDIT_EVENTS.SENT,
    actor: session.email,
    metadata: { via, purpose: a.status === 'signed' ? 'signed_copy_link' : 'signing_link' },
  })
  return { ok: true, url, text, whatsappUrl: buildWhatsAppShareUrl({ recipientName: recipient.name, signingLink: url, phoneE164: recipient.phone }).replace(/\?text=.*$/, `?text=${encodeURIComponent(text)}`) }
}
