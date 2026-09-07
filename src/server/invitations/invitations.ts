import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { cleanOverrides, renderTemplate, resolveMessage, type Variables } from '@/lib/message-template'
import { maskPhone, normalizeIsraeliPhone } from '@/lib/phone'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import { getDb, schema } from '@/server/db'
import { campaignUrlFor } from '@/server/distributions/distributions'
import { authorizeGroup } from '@/server/groups/groups'
import { log } from '@/server/log'
import { brandFor } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { InvitationEmail } from '@/server/mail/templates'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { summarizeTask, type TaskSummary } from '@/server/follow-up/labels'
import { tasksForLeads } from '@/server/follow-up/tasks'

/**
 * One person, invited by name and phone, followed until they sign.
 *
 * An invitation is a `project_leads` row: the same row later becomes the
 * registration (when the person fills the campaign's form) and carries the
 * agreement (when they sign). No supplier or customer is created by inviting
 * someone — that happens by the campaign's own rule after a signature, or by
 * a person choosing "הוסף כספק/לקוח".
 *
 * The personal link is the campaign's public address with the invitation id
 * on it (`?xs_inv=`): stable, no secret, no personal details. Opening it is
 * recorded as a campaign event; the registration that follows reuses this
 * row instead of making a second one. Signing still goes through the phone
 * code — the link is an address, never a key.
 *
 * Sending is a real send only when a provider accepted it. WhatsApp is the
 * rep's own phone: the row says the share opened, and only the rep's word
 * ("כן, ההודעה נשלחה") turns it into a send.
 */

export const INVITE_CHANNELS = ['sms', 'email', 'whatsapp'] as const
export type InviteChannel = (typeof INVITE_CHANNELS)[number]
export type AudienceKind = 'supplier' | 'customer'

/** Where the person is in the process — one axis; message results are another. */
export type ProcessStatus = 'invited' | 'registered' | 'awaiting_signature' | 'signed' | 'failed'
export const PROCESS_LABELS: Record<ProcessStatus, string> = {
  invited: 'הוזמן',
  registered: 'נרשם',
  awaiting_signature: 'ממתין לחתימה',
  signed: 'חתם',
  failed: 'נכשל',
}

export const CALL_OUTCOMES = { interested: 'מעוניין', call_back: 'לחזור אליו', no_answer: 'לא ענה', not_interested: 'לא מעוניין' } as const
export type CallOutcome = keyof typeof CALL_OUTCOMES

const EMAIL_RE = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const UUID_RE = /^[0-9a-f-]{36}$/i
export const DIRECT_SIGNING_KEY = 'direct_signing'

export type Contact = { phone: string | null; email: string | null }

export function normalizeContact(input: { phone?: unknown; email?: unknown }): { ok: true; contact: Contact } | { ok: false; message: string } {
  const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const rawEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const phone = rawPhone ? normalizeIsraeliPhone(rawPhone) : null
  if (rawPhone && !phone) return { ok: false, message: 'מספר הטלפון לא תקין. הזינו מספר נייד ישראלי.' }
  if (rawEmail && !EMAIL_RE.test(rawEmail)) return { ok: false, message: 'כתובת האימייל לא תקינה.' }
  if (!phone && !rawEmail) return { ok: false, message: 'נדרש טלפון או אימייל.' }
  return { ok: true, contact: { phone, email: rawEmail || null } }
}

/**
 * The internal context that holds one-off documents sent from the home
 * page. Behaves like a campaign for tracking and reports, never listed as
 * one. Created on first use, one per organisation.
 */
export async function directSigningGroup(session: StaffSession): Promise<{ id: string; name: string }> {
  const db = getDb()
  const [existing] = await db
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(and(eq(schema.groups.organizationId, session.organizationId), eq(schema.groups.systemKey, DIRECT_SIGNING_KEY)))
    .limit(1)
  if (existing) return existing
  const [created] = await db
    .insert(schema.groups)
    .values({ organizationId: session.organizationId, name: 'חתימות ישירות', createdBy: session.userId, campaignKind: 'signature', goal: 'signing', entryMethod: 'audience', systemKey: DIRECT_SIGNING_KEY })
    .onConflictDoNothing()
    .returning({ id: schema.groups.id, name: schema.groups.name })
  if (created) return created
  const [raced] = await db.select({ id: schema.groups.id, name: schema.groups.name }).from(schema.groups).where(and(eq(schema.groups.organizationId, session.organizationId), eq(schema.groups.systemKey, DIRECT_SIGNING_KEY))).limit(1)
  return raced
}

/** The personal link: the campaign's public page, with the invitation on it. */
export async function invitationLink(groupId: string, leadId: string): Promise<string | null> {
  const [group] = await getDb().select({ landingSlug: schema.groups.landingSlug }).from(schema.groups).where(eq(schema.groups.id, groupId)).limit(1)
  const base = await campaignUrlFor(groupId, group?.landingSlug ?? null)
  return base ? `${base}?xs_inv=${leadId}` : null
}

export type ExistingInvitee = { id: string; name: string; status: ProcessStatus; matchedOn: 'phone' | 'email'; lastActivityAt: Date | null }

/**
 * Who in this campaign already has this phone or email — never a name
 * alone. Shown to the rep before a second invitation goes out, so a
 * "resend" stays a resend and a real newcomer stays a newcomer.
 */
export async function findInvitees(session: StaffSession, groupId: string, contact: Contact): Promise<ExistingInvitee[]> {
  const group = await authorizeGroup(session, groupId)
  if (!contact.phone && !contact.email) return []
  const rows = await getDb()
    .select({ id: schema.projectLeads.id, data: schema.projectLeads.data, phone: schema.projectLeads.phone, email: schema.projectLeads.email, status: schema.projectLeads.status, agreementStatus: schema.agreements.status, lastActivityAt: schema.projectLeads.lastActivityAt })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .where(
      and(
        eq(schema.projectLeads.groupId, group.id),
        or(contact.phone ? eq(schema.projectLeads.phone, contact.phone) : sql`false`, contact.email ? eq(schema.projectLeads.email, contact.email) : sql`false`),
      ),
    )
    .limit(10)
  return rows.map((r) => ({
    id: r.id,
    name: nameOf(r.data),
    status: processStatus(r.status, r.agreementStatus),
    matchedOn: contact.phone && r.phone === contact.phone ? 'phone' : 'email',
    lastActivityAt: r.lastActivityAt,
  }))
}

export function nameOf(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  for (const key of ['name', 'businessName', 'contactName', 'signerName']) if (typeof d[key] === 'string' && (d[key] as string).trim()) return (d[key] as string).trim()
  return ''
}

export function processStatus(leadStatus: string, agreementStatus: string | null | undefined): ProcessStatus {
  if (agreementStatus === 'signed') return 'signed'
  if (agreementStatus === 'sent' || agreementStatus === 'viewed' || agreementStatus === 'expired') return 'awaiting_signature'
  if (leadStatus === 'invited') return 'invited'
  if (leadStatus === 'failed' || leadStatus === 'rejected' || agreementStatus === 'canceled' || agreementStatus === 'declined') return 'failed'
  return 'registered'
}

export type CreateInvitationInput = {
  groupId: string
  name: string
  phone?: string | null
  email?: string | null
  kind?: AudienceKind | null
  /** An existing supplier/customer the person belongs to, chosen by the rep. */
  companyId?: string | null
  /** The agreement a direct send made for them, when there is one already. */
  agreementId?: string | null
}

export type Invitation = { id: string; name: string; contact: Contact; link: string | null }

export async function createInvitation(session: StaffSession, input: CreateInvitationInput): Promise<{ ok: true; invitation: Invitation } | { ok: false; message: string }> {
  const group = await authorizeGroup(session, input.groupId)
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!name) return { ok: false, message: 'נדרש שם.' }
  const normalized = normalizeContact({ phone: input.phone, email: input.email })
  if (!normalized.ok) return normalized
  const kind = input.kind ?? (group.kind === 'customer' ? 'customer' : group.kind === 'supplier' ? 'supplier' : null)
  if (group.kind === null && !kind && !group.systemKey) return { ok: false, message: 'בחרו אם זה ספק או לקוח.' }
  const db = getDb()
  const [row] = await db
    .insert(schema.projectLeads)
    .values({
      organizationId: session.organizationId,
      groupId: group.id,
      status: input.agreementId ? 'converted' : 'invited',
      data: { name, phone: normalized.contact.phone, email: normalized.contact.email },
      source: 'invitation',
      phone: normalized.contact.phone,
      email: normalized.contact.email,
      kind,
      invitedBy: session.userId,
      companyId: input.companyId ?? null,
      agreementId: input.agreementId ?? null,
      lastActivityAt: new Date(),
    })
    .returning({ id: schema.projectLeads.id })
  return { ok: true, invitation: { id: row.id, name, contact: normalized.contact, link: await invitationLink(group.id, row.id) } }
}

async function ownedLead(session: StaffSession, leadId: string) {
  if (!UUID_RE.test(leadId)) return null
  const [lead] = await getDb()
    .select()
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.id, leadId), eq(schema.projectLeads.organizationId, session.organizationId)))
    .limit(1)
  return lead ?? null
}

/** The words the campaign sends, rendered for one person. */
async function renderInvitation(session: StaffSession, groupId: string, lead: { data: unknown; phone: string | null; email: string | null }, link: string) {
  const group = await authorizeGroup(session, groupId)
  const [org] = await getDb().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, session.organizationId)).limit(1)
  const message = resolveMessage('invitation', cleanOverrides(group.messageOverrides).invitation)
  const name = nameOf(lead.data)
  const vars: Variables = {
    campaign_name: group.name,
    campaign_url: link,
    signing_link: link,
    signer_name: name,
    contact_name: name,
    first_name: name.split(' ')[0] ?? name,
    company_name: name,
    document_name: group.name,
    organization_name: org?.name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
  }
  const sms = message.sms ? renderTemplate(message.sms, vars).text : null
  let email: { subject: string; html: string; text: string } | null = null
  if (message.email) {
    const subject = renderTemplate(message.email.subject, vars).text
    const body = renderTemplate(message.email.body, vars).text
    const cta = renderTemplate(message.email.cta ?? '', vars).text
    const brand = await brandFor({ organizationId: session.organizationId })
    email = await renderEmail(subject, InvitationEmail({ brand, title: subject, body, organizationName: vars.organization_name ?? '', cta: cta || 'לפתיחת הקישור', signingUrl: link, facts: [] }))
  }
  return { sms, email, vars, name }
}

export type SendResult = { ok: true; sendId: string } | { ok: false; message: string }

/** SMS or email through the provider; the row records exactly what left and whether it was accepted. */
export async function sendInvitation(session: StaffSession, leadId: string, channel: 'sms' | 'email'): Promise<SendResult> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'ההזמנה לא נמצאה.' }
  const to = channel === 'sms' ? lead.phone : lead.email
  if (!to) return { ok: false, message: channel === 'sms' ? 'אין טלפון להזמנה הזו.' : 'אין אימייל להזמנה הזו.' }
  const link = await invitationLink(lead.groupId, lead.id)
  if (!link) return { ok: false, message: 'לקמפיין אין עמוד ציבורי לשלוח אליו.' }
  const rendered = await renderInvitation(session, lead.groupId, lead, link)
  const db = getDb()
  let result: { ok: boolean; providerMessageId: string | null; error?: string }
  let subject: string | null = null
  let body: string
  if (channel === 'sms') {
    if (!rendered.sms) return { ok: false, message: 'לקמפיין אין נוסח SMS להזמנה.' }
    body = rendered.sms
    result = await new InforuSmsProvider().send({ to, text: body, recipientName: rendered.name })
  } else {
    if (!rendered.email) return { ok: false, message: 'לקמפיין אין נוסח אימייל להזמנה.' }
    subject = rendered.email.subject
    body = rendered.email.text
    result = await new InforuEmailProvider().send({ to, subject, text: body, html: rendered.email.html, recipientName: rendered.name })
  }
  const [send] = await db
    .insert(schema.messageSends)
    .values({
      organizationId: session.organizationId,
      groupId: lead.groupId,
      agreementId: lead.agreementId,
      leadId: lead.id,
      sentBy: session.userId,
      channel,
      event: 'invitation',
      recipient: to,
      subject,
      body,
      variables: rendered.vars,
      providerMessageId: result.providerMessageId,
      ok: result.ok,
      error: result.ok ? null : (result.error ?? 'השליחה נכשלה'),
    })
    .returning({ id: schema.messageSends.id })
  await db.update(schema.projectLeads).set({ lastActivityAt: new Date(), inviteChannel: lead.inviteChannel ?? channel }).where(eq(schema.projectLeads.id, lead.id))
  if (!result.ok) log.warn('invitation send failed', { leadId: lead.id, channel, error: result.error })
  return result.ok ? { ok: true, sendId: send.id } : { ok: false, message: humanSendError(result.error) }
}

export function humanSendError(error: string | undefined): string {
  if (!error) return 'השליחה נכשלה. נסו שוב בעוד רגע.'
  if (/mailing list|invalid|not valid|address/i.test(error)) return 'הכתובת לא התקבלה אצל ספק ההודעות. בדקו את הפרטים ונסו שוב.'
  if (/credentials|missing|SIGN_LOG_NOTIFICATIONS/i.test(error)) return 'שירות ההודעות אינו מוגדר בסביבה הזו, ההודעה נרשמה בלבד.'
  return 'השליחה נכשלה. נסו שוב בעוד רגע.'
}

/**
 * WhatsApp: the rep's phone does the sending. The row says the share
 * opened; `confirmWhatsapp` records what the rep saw happen.
 */
export async function whatsappInvitation(session: StaffSession, leadId: string): Promise<{ ok: true; sendId: string; url: string; text: string } | { ok: false; message: string }> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'ההזמנה לא נמצאה.' }
  const link = await invitationLink(lead.groupId, lead.id)
  if (!link) return { ok: false, message: 'לקמפיין אין עמוד ציבורי לשלוח אליו.' }
  const rendered = await renderInvitation(session, lead.groupId, lead, link)
  const text = rendered.sms ?? `שלום ${rendered.name}, מצורף קישור אישי: ${link}`
  const [send] = await getDb()
    .insert(schema.messageSends)
    .values({ organizationId: session.organizationId, groupId: lead.groupId, agreementId: lead.agreementId, leadId: lead.id, sentBy: session.userId, channel: 'whatsapp', event: 'invitation', recipient: lead.phone ?? '', body: text, variables: rendered.vars, ok: false, error: null, manualState: 'opened' })
    .returning({ id: schema.messageSends.id })
  await getDb().update(schema.projectLeads).set({ lastActivityAt: new Date(), inviteChannel: lead.inviteChannel ?? 'whatsapp' }).where(eq(schema.projectLeads.id, lead.id))
  const url = buildWhatsAppShareUrl({ recipientName: rendered.name, signingLink: link, phoneE164: lead.phone }).replace(/\?text=.*$/, `?text=${encodeURIComponent(text)}`)
  return { ok: true, sendId: send.id, url, text }
}

export async function confirmWhatsapp(session: StaffSession, sendId: string, sent: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!UUID_RE.test(sendId)) return { ok: false, message: 'לא נמצא.' }
  const db = getDb()
  const [row] = await db.select({ id: schema.messageSends.id, channel: schema.messageSends.channel }).from(schema.messageSends).where(and(eq(schema.messageSends.id, sendId), eq(schema.messageSends.organizationId, session.organizationId))).limit(1)
  if (!row || row.channel !== 'whatsapp') return { ok: false, message: 'לא נמצא.' }
  await db.update(schema.messageSends).set({ manualState: sent ? 'sent' : 'not_sent', manualBy: session.userId, manualAt: new Date(), ok: sent, sentAt: new Date() }).where(eq(schema.messageSends.id, row.id))
  return { ok: true }
}

// ── the rep's view ──────────────────────────────────────────────────────────

export type AudienceView = 'all' | 'invited' | 'waiting' | 'registered' | 'signed'
export const AUDIENCE_VIEWS: { key: AudienceView; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'invited', label: 'הוזמנו' },
  { key: 'waiting', label: 'ממתינים' },
  { key: 'registered', label: 'נרשמו' },
  { key: 'signed', label: 'חתמו' },
]

export type AudienceRow = {
  id: string
  groupId: string
  groupName: string
  /** A direct send from the home page rather than a campaign. */
  isDirect: boolean
  name: string
  phone: string | null
  maskedPhone: string | null
  email: string | null
  kind: AudienceKind | null
  status: ProcessStatus
  source: string
  invitedBy: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
  followUpAt: string | null
  callOutcome: CallOutcome | null
  internalNote: string | null
  companyId: string | null
  companyName: string | null
  agreementId: string | null
  agreementStatus: string | null
  lastActivityAt: string | null
  lastActivity: string
  createdAt: string
  /** The newest message: what happened to it, in words. */
  lastSend: { channel: string; ok: boolean; manualState: string | null; at: string; error: string | null } | null
  linkingNeeded: boolean
  /** The follow-up task a signature created, when the campaign makes one. */
  task: TaskSummary | null
}

export type AudienceFilters = { view?: AudienceView; q?: string; rep?: string; channel?: string; followUpDue?: boolean; limit?: number }

/**
 * Everyone the campaign reached or who reached it, one row each, with the
 * newest word on where they are. The views are questions about the rows —
 * "ממתינים" is invited or registered but not signed — never separate lists.
 */
export async function listAudience(session: StaffSession, groupId: string, filters: AudienceFilters = {}): Promise<{ rows: AudienceRow[]; counts: Record<AudienceView, number>; total: number }> {
  const group = await authorizeGroup(session, groupId)
  return audienceRows(session, [group], filters)
}

export type AudienceAllFilters = AudienceFilters & { groupId?: string | 'direct' }

/**
 * The whole organisation's tracking: every campaign and the direct sends,
 * one table. Filtered to one campaign (or to "חתימה ישירה") when asked.
 */
export async function listAudienceAll(session: StaffSession, filters: AudienceAllFilters = {}): Promise<{ rows: AudienceRow[]; counts: Record<AudienceView, number>; total: number; campaigns: { id: string; name: string }[] }> {
  const db = getDb()
  const groups = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.organizationId, session.organizationId), isNull(schema.groups.deletedAt)))
    .orderBy(desc(schema.groups.createdAt))
  const campaigns = groups.filter((g) => !g.systemKey).map((g) => ({ id: g.id, name: g.name }))
  const chosen = filters.groupId === 'direct' ? groups.filter((g) => g.systemKey === DIRECT_SIGNING_KEY) : filters.groupId ? groups.filter((g) => g.id === filters.groupId) : groups
  const result = chosen.length ? await audienceRows(session, chosen, filters) : { rows: [], counts: { all: 0, invited: 0, waiting: 0, registered: 0, signed: 0 }, total: 0 }
  return { ...result, campaigns }
}

type GroupRow = typeof schema.groups.$inferSelect

async function audienceRows(session: StaffSession, groups: GroupRow[], filters: AudienceFilters): Promise<{ rows: AudienceRow[]; counts: Record<AudienceView, number>; total: number }> {
  const db = getDb()
  const groupIds = groups.map((g) => g.id)
  const groupOf = (id: string) => groups.find((g) => g.id === id)!
  const term = filters.q?.trim()
  const like = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const digits = term?.replace(/\D/g, '') ?? ''
  const rows = await db
    .select({
      lead: schema.projectLeads,
      agreementStatus: schema.agreements.status,
      companyName: schema.companies.name,
    })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.projectLeads.companyId))
    .where(
      and(
        inArray(schema.projectLeads.groupId, groupIds),
        sql`${schema.projectLeads.status} <> 'pending'`,
        like ? sql`(${schema.projectLeads.data}::text ilike ${like} or ${schema.companies.name} ilike ${like}${digits.length >= 4 ? sql` or ${schema.projectLeads.phone} like ${`%${digits.slice(-9)}%`}` : sql``})` : undefined,
        filters.rep && UUID_RE.test(filters.rep) ? or(eq(schema.projectLeads.invitedBy, filters.rep), eq(schema.projectLeads.assigneeUserId, filters.rep)) : undefined,
        filters.channel ? eq(schema.projectLeads.inviteChannel, filters.channel) : undefined,
        filters.followUpDue ? sql`${schema.projectLeads.followUpAt} <= now()` : undefined,
      ),
    )
    .orderBy(desc(sql`coalesce(${schema.projectLeads.lastActivityAt}, ${schema.projectLeads.createdAt})`))
    .limit(Math.min(filters.limit ?? 500, 2000))

  const userIds = [...new Set(rows.flatMap((r) => [r.lead.invitedBy, r.lead.assigneeUserId]).filter((x): x is string => Boolean(x)))]
  const users = userIds.length ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, userIds)) : []
  const userName = (id: string | null) => {
    if (!id) return null
    const u = users.find((x) => x.id === id)
    return u ? { id: u.id, name: u.name || u.email } : null
  }
  const leadIds = rows.map((r) => r.lead.id)
  const sends = leadIds.length
    ? await db
        .select({ leadId: schema.messageSends.leadId, agreementId: schema.messageSends.agreementId, channel: schema.messageSends.channel, ok: schema.messageSends.ok, manualState: schema.messageSends.manualState, sentAt: schema.messageSends.sentAt, error: schema.messageSends.error, event: schema.messageSends.event })
        .from(schema.messageSends)
        .where(and(eq(schema.messageSends.organizationId, session.organizationId), eq(schema.messageSends.isTest, false), or(inArray(schema.messageSends.leadId, leadIds), inArray(schema.messageSends.agreementId, rows.map((r) => r.lead.agreementId).filter((x): x is string => Boolean(x)).concat(['00000000-0000-0000-0000-000000000000'])))))
        .orderBy(desc(schema.messageSends.sentAt))
    : []

  const tasks = leadIds.length ? await tasksForLeads(session.organizationId, leadIds) : new Map<string, unknown[]>()
  const all: AudienceRow[] = rows.map(({ lead, agreementStatus, companyName }) => {
    const status = processStatus(lead.status, agreementStatus)
    const last = sends.find((s) => s.leadId === lead.id || (lead.agreementId && s.agreementId === lead.agreementId)) ?? null
    const meta = (lead.meta ?? {}) as Record<string, unknown>
    const group = groupOf(lead.groupId)
    return {
      id: lead.id,
      groupId: lead.groupId,
      groupName: group.systemKey === DIRECT_SIGNING_KEY ? 'חתימה ישירה' : group.name,
      isDirect: group.systemKey === DIRECT_SIGNING_KEY,
      name: nameOf(lead.data) || companyName || '—',
      phone: lead.phone ?? stringIn(lead.data, 'phone'),
      maskedPhone: maskPhone(lead.phone ?? stringIn(lead.data, 'phone')) ?? null,
      email: lead.email ?? stringIn(lead.data, 'email'),
      kind: (lead.kind as AudienceKind | null) ?? (group.kind as AudienceKind | null),
      status,
      source: lead.source,
      invitedBy: userName(lead.invitedBy),
      assignee: userName(lead.assigneeUserId),
      followUpAt: lead.followUpAt?.toISOString() ?? null,
      callOutcome: (lead.callOutcome as CallOutcome | null) ?? null,
      internalNote: lead.internalNote,
      companyId: lead.companyId,
      companyName,
      agreementId: lead.agreementId,
      agreementStatus,
      lastActivityAt: (lead.lastActivityAt ?? lead.createdAt).toISOString(),
      lastActivity: describeLast(status, last),
      createdAt: lead.createdAt.toISOString(),
      lastSend: last ? { channel: last.channel, ok: last.ok, manualState: last.manualState, at: last.sentAt.toISOString(), error: last.error } : null,
      linkingNeeded: meta.linking === 'needed',
      task: firstTask(tasks.get(lead.id)),
    }
  })
  const counts: Record<AudienceView, number> = { all: all.length, invited: 0, waiting: 0, registered: 0, signed: 0 }
  for (const row of all) {
    if (row.status === 'invited') counts.invited++
    if (row.status === 'invited' || row.status === 'registered' || row.status === 'awaiting_signature') counts.waiting++
    if (row.status === 'registered' || row.status === 'awaiting_signature' || row.status === 'signed') counts.registered++
    if (row.status === 'signed') counts.signed++
  }
  const view = filters.view ?? 'all'
  const filtered = all.filter((row) =>
    view === 'all' ? true : view === 'invited' ? row.status === 'invited' : view === 'waiting' ? ['invited', 'registered', 'awaiting_signature'].includes(row.status) : view === 'registered' ? ['registered', 'awaiting_signature', 'signed'].includes(row.status) : row.status === 'signed',
  )
  return { rows: filtered, counts, total: filtered.length }
}

function firstTask(list: unknown[] | undefined): TaskSummary | null {
  const t = list?.[0] as Parameters<typeof summarizeTask>[0] | undefined
  return t ? summarizeTask(t) : null
}

function stringIn(data: unknown, key: string): string | null {
  const d = (data ?? {}) as Record<string, unknown>
  return typeof d[key] === 'string' && (d[key] as string).trim() ? (d[key] as string).trim() : null
}

const CHANNEL_WORD: Record<string, string> = { sms: 'SMS', email: 'מייל', whatsapp: 'WhatsApp' }
const EVENT_WORD: Record<string, string> = { invitation: 'הזמנה', reminder: 'תזכורת', signed_confirmation: 'עותק חתום', registration_completed: 'קישור לחתימה', distribution: 'הפצה' }

function describeLast(status: ProcessStatus, last: { channel: string; ok: boolean; manualState: string | null; event: string } | null): string {
  if (status === 'signed') return 'נחתם'
  if (!last) return status === 'invited' ? 'טרם נשלח' : status === 'registered' ? 'נרשם' : status === 'awaiting_signature' ? 'ממתין לחתימה' : '—'
  const what = `${EVENT_WORD[last.event] ?? 'הודעה'} ב-${CHANNEL_WORD[last.channel] ?? last.channel}`
  if (last.channel === 'whatsapp') return last.manualState === 'sent' ? `${what} — נשלח` : last.manualState === 'not_sent' ? `${what} — לא נשלח` : `${what} — נפתח, לא אושר`
  return last.ok ? `${what} — נשלח` : `${what} — נכשל`
}

export type SendHistoryItem = { id: string; at: string; channel: string; event: string; to: string; ok: boolean; manualState: string | null; error: string | null; by: string | null; retryOf: string | null }

/** Every message for this person, newest first — the invitation's and the agreement's. */
export async function sendHistory(session: StaffSession, leadId: string): Promise<SendHistoryItem[]> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return []
  const db = getDb()
  const rows = await db
    .select({ id: schema.messageSends.id, sentAt: schema.messageSends.sentAt, channel: schema.messageSends.channel, event: schema.messageSends.event, recipient: schema.messageSends.recipient, ok: schema.messageSends.ok, manualState: schema.messageSends.manualState, error: schema.messageSends.error, sentBy: schema.messageSends.sentBy, retryOf: schema.messageSends.retryOf, isTest: schema.messageSends.isTest })
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.organizationId, session.organizationId), or(eq(schema.messageSends.leadId, lead.id), lead.agreementId ? eq(schema.messageSends.agreementId, lead.agreementId) : sql`false`)))
    .orderBy(desc(schema.messageSends.sentAt))
    .limit(50)
  const userIds = [...new Set(rows.map((r) => r.sentBy).filter((x): x is string => Boolean(x)))]
  const users = userIds.length ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, userIds)) : []
  return rows
    .filter((r) => !r.isTest)
    .map((r) => ({
      id: r.id,
      at: r.sentAt.toISOString(),
      channel: r.channel,
      event: r.event,
      to: r.channel === 'sms' || r.channel === 'whatsapp' ? (maskPhone(r.recipient) ?? r.recipient) : r.recipient.replace(/^(.{2}).+(@.+)$/, '$1…$2'),
      ok: r.ok,
      manualState: r.manualState,
      error: r.error,
      by: users.find((u) => u.id === r.sentBy)?.name ?? null,
      retryOf: r.retryOf,
    }))
}

export type FollowUpPatch = { assigneeUserId?: string | null; followUpAt?: string | null; callOutcome?: CallOutcome | null; internalNote?: string | null }

export async function updateFollowUp(session: StaffSession, leadId: string, patch: FollowUpPatch): Promise<{ ok: true } | { ok: false; message: string }> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'לא נמצא.' }
  const set: Partial<typeof schema.projectLeads.$inferInsert> = { lastActivityAt: new Date() }
  if ('assigneeUserId' in patch) {
    if (patch.assigneeUserId && !UUID_RE.test(patch.assigneeUserId)) return { ok: false, message: 'אחראי לא תקין.' }
    if (patch.assigneeUserId) {
      const [u] = await getDb().select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, patch.assigneeUserId), eq(schema.users.organizationId, session.organizationId))).limit(1)
      if (!u) return { ok: false, message: 'האחראי לא נמצא בצוות.' }
    }
    set.assigneeUserId = patch.assigneeUserId ?? null
  }
  if ('followUpAt' in patch) {
    const at = patch.followUpAt ? new Date(patch.followUpAt) : null
    if (at && Number.isNaN(at.getTime())) return { ok: false, message: 'תאריך לא תקין.' }
    set.followUpAt = at
  }
  if ('callOutcome' in patch) {
    if (patch.callOutcome && !(patch.callOutcome in CALL_OUTCOMES)) return { ok: false, message: 'תוצאה לא מוכרת.' }
    set.callOutcome = patch.callOutcome ?? null
  }
  if ('internalNote' in patch) set.internalNote = typeof patch.internalNote === 'string' ? patch.internalNote.trim().slice(0, 2000) || null : null
  await getDb().update(schema.projectLeads).set(set).where(eq(schema.projectLeads.id, lead.id))
  return { ok: true }
}

// ── becoming a supplier or a customer ───────────────────────────────────────

export type CompanyMatch = { id: string; name: string; kind: string; fromCrm: boolean; matchedOn: 'taxId' | 'phone' | 'email' }

/**
 * Possible existing records for this person: same phone or email, shown to
 * a person to decide. A shared phone is a hint, never proof — the rep
 * links, the system never links by itself here.
 */
export async function companyMatchesFor(session: StaffSession, leadId: string): Promise<CompanyMatch[]> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return []
  const phone = lead.phone ?? stringIn(lead.data, 'phone')
  const email = (lead.email ?? stringIn(lead.data, 'email'))?.toLowerCase() ?? null
  const taxId = stringIn(lead.data, 'taxId')?.replace(/\D/g, '') ?? null
  if (!phone && !email && !taxId) return []
  const rows = await getDb()
    .select({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind, crmRecordId: schema.companies.crmRecordId, phone: schema.companies.contactPhone, email: schema.companies.contactEmail, taxId: schema.companies.taxId })
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.organizationId, session.organizationId),
        isNull(schema.companies.deletedAt),
        or(taxId ? eq(schema.companies.taxId, taxId) : sql`false`, phone ? eq(schema.companies.contactPhone, phone) : sql`false`, email ? sql`lower(${schema.companies.contactEmail}) = ${email}` : sql`false`),
      ),
    )
    .limit(10)
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, fromCrm: Boolean(r.crmRecordId), matchedOn: taxId && r.taxId === taxId ? 'taxId' : phone && r.phone === phone ? 'phone' : 'email' }))
}

/**
 * "הוסף כספק/לקוח": links the row to a record the rep chose, or creates a
 * local one. Local only — nothing is written to the CRM. The agreement, when
 * there is one, follows the row.
 */
export async function attachCompany(session: StaffSession, leadId: string, choice: { companyId: string } | { create: { kind: AudienceKind } }): Promise<{ ok: true; companyId: string } | { ok: false; message: string }> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'לא נמצא.' }
  const db = getDb()
  let companyId: string
  if ('companyId' in choice) {
    if (!UUID_RE.test(choice.companyId)) return { ok: false, message: 'רשומה לא תקינה.' }
    const [company] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.id, choice.companyId), eq(schema.companies.organizationId, session.organizationId), isNull(schema.companies.deletedAt))).limit(1)
    if (!company) return { ok: false, message: 'הרשומה לא נמצאה.' }
    companyId = company.id
  } else {
    const name = nameOf(lead.data)
    if (!name) return { ok: false, message: 'להזמנה אין שם.' }
    const [created] = await db
      .insert(schema.companies)
      .values({
        organizationId: session.organizationId,
        kind: choice.create.kind,
        name,
        source: 'xtra',
        contactName: stringIn(lead.data, 'contactName') ?? name,
        contactPhone: lead.phone ?? stringIn(lead.data, 'phone'),
        contactEmail: lead.email ?? stringIn(lead.data, 'email'),
        taxId: stringIn(lead.data, 'taxId')?.replace(/\D/g, '') ?? null,
      })
      .returning({ id: schema.companies.id })
    companyId = created.id
  }
  await db.update(schema.projectLeads).set({ companyId, lastActivityAt: new Date(), meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) - 'linking'` }).where(eq(schema.projectLeads.id, lead.id))
  if (lead.agreementId) await db.update(schema.agreements).set({ companyId }).where(and(eq(schema.agreements.id, lead.agreementId), isNull(schema.agreements.companyId)))
  await db.insert(schema.companyGroups).values({ companyId, groupId: lead.groupId }).onConflictDoNothing()
  return { ok: true, companyId }
}
