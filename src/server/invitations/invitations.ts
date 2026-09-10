import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { cleanOverrides, renderTemplate, resolveMessage, type Variables } from '@/lib/message-template'
import { maskPhone, normalizeIsraeliPhone } from '@/lib/phone'
import { joiningProgress, type JoiningProgress } from '@/lib/joining-progress'
import { agreementEvidence, invitationOpenEvidence, leadSendEvidence } from '@/server/progress/evidence'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import { getDb, schema } from '@/server/db'
import { campaignUrlFor } from '@/server/distributions/distributions'
import { authorizeGroup } from '@/server/groups/groups'
import { cancelAgreement } from '@/server/documents/lifecycle'
import { brandFor } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { InvitationEmail } from '@/server/mail/templates'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { dispatch, humanize } from '@/server/messaging/dispatch'
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
  /** The client's key for this one action: a retry with the same key returns the same row instead of a second person. */
  operationId?: string | null
  name: string
  phone?: string | null
  email?: string | null
  kind?: AudienceKind | null
  /** An existing supplier/customer the person belongs to, chosen by the rep. */
  companyId?: string | null
  /** The agreement a direct send made for them, when there is one already. */
  agreementId?: string | null
}

export type Invitation = { id: string; name: string; contact: Contact; link: string | null; /** True when this call found the row an earlier attempt made. */ replayed?: boolean }

export function operationKey(groupId: string, operationId: string): string {
  return createHash('sha256').update(`${groupId}:op:${operationId.trim().slice(0, 120)}`).digest('hex')
}

export async function createInvitation(session: StaffSession, input: CreateInvitationInput): Promise<{ ok: true; invitation: Invitation } | { ok: false; message: string }> {
  const group = await authorizeGroup(session, input.groupId)
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!name) return { ok: false, message: 'נדרש שם.' }
  const normalized = normalizeContact({ phone: input.phone, email: input.email })
  if (!normalized.ok) return normalized
  const kind = input.kind ?? (group.kind === 'customer' ? 'customer' : group.kind === 'supplier' ? 'supplier' : null)
  if (group.kind === null && !kind && !group.systemKey) return { ok: false, message: 'בחרו אם זה ספק או לקוח.' }
  const db = getDb()
  const idempotencyKey = input.operationId && /^[A-Za-z0-9:_-]{8,120}$/.test(input.operationId) ? operationKey(group.id, input.operationId) : null
  const inserted = await db
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
      idempotencyKey,
      lastActivityAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.projectLeads.id })
  if (inserted[0]) return { ok: true, invitation: { id: inserted[0].id, name, contact: normalized.contact, link: await invitationLink(group.id, inserted[0].id) } }
  // The same action, again (a retry, a second click): the row it already made.
  const [existing] = await db.select({ id: schema.projectLeads.id }).from(schema.projectLeads).where(and(eq(schema.projectLeads.groupId, group.id), eq(schema.projectLeads.idempotencyKey, idempotencyKey!))).limit(1)
  if (!existing) return { ok: false, message: 'ההזמנה לא נשמרה. נסו שוב.' }
  return { ok: true, invitation: { id: existing.id, name, contact: normalized.contact, link: await invitationLink(group.id, existing.id), replayed: true } }
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

/**
 * Take one process off the list — a test invitation, a wrong number, a
 * duplicate someone created by mistake.
 *
 * What it will not do: touch anything signed, and never remove the supplier or
 * customer themselves. An agreement that was already sent is canceled rather
 * than deleted, so its history and its audit trail stay, and its link stops
 * opening. Only the process row goes.
 */
export async function removeInvitation(session: StaffSession, leadId: string): Promise<{ ok: true; canceledAgreement: boolean } | { ok: false; message: string }> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'לא נמצא.' }
  await authorizeGroup(session, lead.groupId)

  let canceledAgreement = false
  if (lead.agreementId) {
    const [agreement] = await getDb().select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, lead.agreementId)).limit(1)
    if (agreement?.status === 'signed') return { ok: false, message: 'אי אפשר למחוק אחרי שההסכם נחתם. אפשר להעביר את ההסכם לארכיון.' }
    if (agreement && agreement.status !== 'canceled') {
      const canceled = await cancelAgreement({ session, agreementId: lead.agreementId })
      if (!canceled.ok) return { ok: false, message: canceled.message }
      canceledAgreement = true
    }
  }

  // The person's own record and the company stay; only the campaign process goes.
  await getDb().delete(schema.projectLeads).where(eq(schema.projectLeads.id, lead.id))
  await getDb().insert(schema.adminAuditEvents).values({
    organizationId: session.organizationId,
    type: 'invitation_removed',
    actorEmail: session.email,
    metadata: { leadId: lead.id, groupId: lead.groupId, agreementId: lead.agreementId, canceledAgreement, name: (lead.data as Record<string, unknown> | null)?.name ?? null },
  })
  return { ok: true, canceledAgreement }
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

export type SendResult = { ok: true; sendId: string; state: 'sent' | 'duplicate' } | { ok: false; message: string; state: string; retryAfter?: number }

export type SendOptions = { attemptKey?: string | null; force?: boolean }

/**
 * SMS or email, through the dispatcher: permission, eligibility, the
 * do-not-contact list, the rate limit, the 24-hour cooldown and the
 * reservation all happen before the provider hears about it.
 */
export async function sendInvitation(session: StaffSession, leadId: string, channel: 'sms' | 'email', options: SendOptions = {}): Promise<SendResult> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'ההזמנה לא נמצאה.', state: 'not_found' }
  const link = await invitationLink(lead.groupId, lead.id)
  if (!link) return { ok: false, message: 'לקמפיין אין עמוד ציבורי לשלוח אליו.', state: 'not_eligible' }
  const status = await statusOfLead(lead)
  const result = await dispatch({
    session,
    lead: { id: lead.id, organizationId: lead.organizationId, groupId: lead.groupId, agreementId: lead.agreementId, status: lead.status, phone: lead.phone, email: lead.email },
    processStatus: status,
    channel,
    event: 'invitation',
    attemptKey: options.attemptKey,
    force: options.force,
    render: async () => {
      const rendered = await renderInvitation(session, lead.groupId, lead, link)
      if (channel === 'sms') {
        if (!rendered.sms) throw new Error('לקמפיין אין נוסח SMS להזמנה.')
        return { to: lead.phone!, subject: null, body: rendered.sms, variables: rendered.vars }
      }
      if (!rendered.email) throw new Error('לקמפיין אין נוסח אימייל להזמנה.')
      return { to: lead.email!, subject: rendered.email.subject, body: rendered.email.text, html: rendered.email.html, variables: rendered.vars }
    },
    send: (message) =>
      channel === 'sms'
        ? new InforuSmsProvider().send({ to: message.to, text: message.body, recipientName: nameOf(lead.data) })
        : new InforuEmailProvider().send({ to: message.to, subject: message.subject ?? '', text: message.body, html: message.html ?? message.body, recipientName: nameOf(lead.data) }),
  }).catch((error): DispatchResultLike => ({ ok: false, state: 'failed', message: error instanceof Error ? error.message : 'השליחה נכשלה.' }))
  if (!result.ok) return { ok: false, message: result.message, state: result.state, retryAfter: result.retryAfter }
  await db_touch(lead.id, lead.inviteChannel ?? channel)
  return { ok: true, sendId: result.sendId, state: result.state === 'duplicate' ? 'duplicate' : 'sent' }
}

type DispatchResultLike = { ok: false; state: string; message: string; retryAfter?: number }

async function db_touch(leadId: string, inviteChannel: string) {
  await getDb().update(schema.projectLeads).set({ lastActivityAt: new Date(), inviteChannel }).where(eq(schema.projectLeads.id, leadId))
}

async function statusOfLead(lead: { status: string; agreementId: string | null }): Promise<ProcessStatus> {
  if (!lead.agreementId) return processStatus(lead.status, null)
  const [a] = await getDb().select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, lead.agreementId)).limit(1)
  return processStatus(lead.status, a?.status ?? null)
}

export function humanSendError(error: string | undefined): string {
  return humanize(error)
}

/**
 * WhatsApp: the rep's phone does the sending. The reservation is the record
 * that the share opened; `confirmWhatsapp` records what the rep saw happen.
 * Same door as every other message — a signed person or a suppressed
 * number is refused before anything opens.
 */
export async function whatsappInvitation(session: StaffSession, leadId: string, options: SendOptions = {}): Promise<{ ok: true; sendId: string; url: string; text: string } | { ok: false; message: string; state: string }> {
  const lead = await ownedLead(session, leadId)
  if (!lead) return { ok: false, message: 'ההזמנה לא נמצאה.', state: 'not_found' }
  const link = await invitationLink(lead.groupId, lead.id)
  if (!link) return { ok: false, message: 'לקמפיין אין עמוד ציבורי לשלוח אליו.', state: 'not_eligible' }
  const status = await statusOfLead(lead)
  const result = await dispatch({
    session,
    lead: { id: lead.id, organizationId: lead.organizationId, groupId: lead.groupId, agreementId: lead.agreementId, status: lead.status, phone: lead.phone, email: lead.email },
    processStatus: status,
    channel: 'whatsapp',
    event: 'invitation',
    attemptKey: options.attemptKey,
    force: options.force,
    render: async () => {
      const rendered = await renderInvitation(session, lead.groupId, lead, link)
      return { to: lead.phone!, subject: null, body: rendered.sms ?? `שלום ${rendered.name}, מצורף קישור אישי: ${link}`, variables: rendered.vars }
    },
  }).catch((error): DispatchResultLike => ({ ok: false, state: 'failed', message: error instanceof Error ? error.message : 'השליחה נכשלה.' }))
  if (!result.ok) return { ok: false, message: result.message, state: result.state }
  await db_touch(lead.id, lead.inviteChannel ?? 'whatsapp')
  const url = buildWhatsAppShareUrl({ recipientName: nameOf(lead.data), signingLink: link, phoneE164: lead.phone }).replace(/\?text=.*$/, `?text=${encodeURIComponent(result.body)}`)
  return { ok: true, sendId: result.sendId, url, text: result.body }
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

export type AudienceView = 'all' | 'invitations' | 'invited' | 'waiting' | 'registered' | 'signed'

/**
 * A personal invitation a member of staff started — not someone who found the
 * campaign page and signed up on their own. This is the whole difference
 * between "הזמנות ומעקב" and "הרשמות": the first is our own outreach and the
 * work it left open, the second is everyone who actually filled the form.
 */
export function isStaffInvitation(row: { invitedBy: { id: string } | null; source: string | null }): boolean {
  return Boolean(row.invitedBy) || row.source === 'invitation'
}

/** What a person still needs, by the campaign's goal: signing campaigns wait for a signature; inquiries wait for the team's decision. */
export function isWaiting(row: { status: ProcessStatus; leadStatus: string }, goal: string | null): boolean {
  if (row.status === 'signed' || row.status === 'failed') return false
  if (goal === 'inquiries') return row.status === 'invited' || row.leadStatus === 'new' || row.leadStatus === 'pending'
  return row.status === 'invited' || row.status === 'registered' || row.status === 'awaiting_signature'
}
export const AUDIENCE_VIEWS: { key: AudienceView; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'invitations', label: 'הזמנות ומעקב' },
  { key: 'invited', label: 'הוזמנו ולא נרשמו' },
  { key: 'registered', label: 'נרשמו ולא חתמו' },
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
  /** The registration row's own status (new / approved / rejected / converted / failed / invited). */
  leadStatus: string
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
  /** Where this person really got to, and what to do next. */
  progress: JoiningProgress
  /** The follow-up tasks a signature created, when the campaign makes any. */
  tasks: TaskSummary[]
}

/**
 * Where a person got stuck, as the statistics screen counts it — so a number
 * there opens exactly the people behind it, on the same definitions.
 */
export type StuckFilter = 'not_opened' | 'opened_not_submitted' | 'submitted_not_signed' | 'reminded_not_signed' | 'failed'

export function isStuckFilter(value: unknown): value is StuckFilter {
  return value === 'not_opened' || value === 'opened_not_submitted' || value === 'submitted_not_signed' || value === 'reminded_not_signed' || value === 'failed'
}

export type AudienceFilters = { view?: AudienceView; q?: string; rep?: string; channel?: string; followUpDue?: boolean; stuck?: StuckFilter; limit?: number; /** The campaign's tracking tab shows only people who have not signed yet; reports may ask for everyone. */ includeSigned?: boolean }

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
  const result = chosen.length ? await audienceRows(session, chosen, { includeSigned: true, ...filters }) : { rows: [], counts: { all: 0, invitations: 0, invited: 0, waiting: 0, registered: 0, signed: 0 }, total: 0 }
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
  const scope = and(
    inArray(schema.projectLeads.groupId, groupIds),
    sql`${schema.projectLeads.status} <> 'pending'`,
    like ? sql`(${schema.projectLeads.data}::text ilike ${like} or ${schema.companies.name} ilike ${like}${digits.length >= 4 ? sql` or ${schema.projectLeads.phone} like ${`%${digits.slice(-9)}%`}` : sql``})` : undefined,
    filters.rep && UUID_RE.test(filters.rep) ? or(eq(schema.projectLeads.invitedBy, filters.rep), eq(schema.projectLeads.assigneeUserId, filters.rep)) : undefined,
    filters.channel ? eq(schema.projectLeads.inviteChannel, filters.channel) : undefined,
    filters.followUpDue ? sql`${schema.projectLeads.followUpAt} <= now()` : undefined,
  )
  const rows = await db
    .select({
      lead: schema.projectLeads,
      agreementStatus: schema.agreements.status,
      companyName: schema.companies.name,
    })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.projectLeads.companyId))
    .where(scope)
    .orderBy(desc(sql`coalesce(${schema.projectLeads.lastActivityAt}, ${schema.projectLeads.createdAt})`))
    .limit(Math.min(filters.limit ?? 500, 2000))

  /**
   * The numbers on the cards and the chips count everyone the filter matches —
   * never just the page that was fetched. A screen asking for one row to draw
   * a badge must still read the true total.
   */
  const goalOf = groups.length === 1 ? groups[0].goal : null
  const countRows = await db
    .select({ leadStatus: schema.projectLeads.status, agreementStatus: schema.agreements.status, invitedBy: schema.projectLeads.invitedBy, source: schema.projectLeads.source })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.projectLeads.companyId))
    .where(scope)
    .limit(50_000)
  const counts: Record<AudienceView, number> = { all: countRows.length, invitations: 0, invited: 0, waiting: 0, registered: 0, signed: 0 }
  for (const row of countRows) {
    const status = processStatus(row.leadStatus, row.agreementStatus)
    const staff = isStaffInvitation({ invitedBy: row.invitedBy ? { id: row.invitedBy } : null, source: row.source })
    if (staff && status !== 'signed') counts.invitations++
    if (status === 'invited') counts.invited++
    if (isWaiting({ status, leadStatus: row.leadStatus }, goalOf)) counts.waiting++
    if (status === 'registered' || status === 'awaiting_signature' || status === 'signed') counts.registered++
    if (status === 'signed') counts.signed++
  }

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
  // What the rows prove about each signer, for the status line and the drawer.
  const [evidence, leadSends, opens] = await Promise.all([
    agreementEvidence(rows.map((r) => r.lead.agreementId).filter((x): x is string => Boolean(x))),
    leadSendEvidence(leadIds),
    invitationOpenEvidence(leadIds),
  ])
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
      leadStatus: lead.status,
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
      progress: joiningProgress({
        invitedAt: lead.invitedBy || lead.source === 'invitation' ? lead.createdAt.toISOString() : null,
        invitationOpenedAt: opens.get(lead.id) ?? null,
        submittedAt: lead.formSnapshot ? lead.createdAt.toISOString() : null,
        leadStatus: lead.status,
        ...(lead.agreementId ? (evidence.get(lead.agreementId) ?? { agreementStatus }) : { agreementStatus: null, ...(leadSends.get(lead.id) ?? {}) }),
      }),
      tasks: taskList(tasks.get(lead.id)),
    }
  })
  const view = filters.view ?? 'all'
  const goal = goalOf
  // "כל התהליכים" is the full history; every other view is about work left.
  // Only when someone asks who was reminded: one query, over the rows in hand.
  const agreementIds = all.map((r) => r.agreementId).filter((id): id is string => Boolean(id))
  const reminded =
    filters.stuck === 'reminded_not_signed' && agreementIds.length > 0
      ? new Set(
          (
            await getDb()
              .select({ id: schema.auditEvents.agreementId })
              .from(schema.auditEvents)
              .where(and(eq(schema.auditEvents.type, 'reminder_sent'), inArray(schema.auditEvents.agreementId, agreementIds)))
          )
            .map((r) => r.id)
            .filter((id): id is string => Boolean(id)),
        )
      : new Set<string>()

  const includeSigned = filters.includeSigned ?? view === 'all'
  const base = includeSigned ? all : all.filter((row) => row.status !== 'signed')
  if (!includeSigned) counts.registered -= counts.signed
  // The same five definitions the statistics screen counts by, so a number
  // there opens exactly these people (see server/reports/campaign-funnels.ts).
  const stuck = filters.stuck
  const done = (row: AudienceRow, key: string) => Boolean(row.progress.steps.find((s) => s.key === key)?.at)
  const isStuck = (row: AudienceRow): boolean => {
    if (!stuck) return true
    const submitted = done(row, 'form')
    if (stuck === 'not_opened') return isStaffInvitation(row) && !submitted && !done(row, 'invitation_opened')
    if (stuck === 'opened_not_submitted') return isStaffInvitation(row) && !submitted && done(row, 'invitation_opened')
    if (stuck === 'submitted_not_signed') return submitted && row.status !== 'signed'
    if (stuck === 'reminded_not_signed') return row.status !== 'signed' && row.agreementId !== null && reminded.has(row.agreementId)
    return row.status === 'failed'
  }
  const filtered = base.filter(isStuck).filter((row) =>
    view === 'all' ? true
    : view === 'invitations' ? isStaffInvitation(row) && row.status !== 'signed'
    : view === 'invited' ? row.status === 'invited'
    : view === 'waiting' ? isWaiting(row, goal)
    : view === 'registered' ? ['registered', 'awaiting_signature', ...(includeSigned ? ['signed'] : [])].includes(row.status)
    : row.status === 'signed',
  )
  return { rows: filtered, counts, total: filtered.length }
}

function taskList(list: unknown[] | undefined): TaskSummary[] {
  return (list ?? []).map((t) => summarizeTask(t as Parameters<typeof summarizeTask>[0]))
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
