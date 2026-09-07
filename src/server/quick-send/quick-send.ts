import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { buildShareMessage, buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import { getCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { loadFields, saveFields, saveRecipient } from '@/server/documents/save-fields'
import { issueSigningLink, sendAgreement } from '@/server/documents/send-agreement'
import { directSigningGroup, normalizeContact, operationKey, type AudienceKind } from '@/server/invitations/invitations'
import { log } from '@/server/log'
import { humanize } from '@/server/messaging/dispatch'
import { createDocumentFromTemplate } from '@/server/templates/templates'

/**
 * "שלח מסמך לחתימה": name + phone → document → channel → sent.
 *
 * The same pieces a campaign uses, in one call: the document comes from the
 * template, the person is a tracked row under the internal "חתימות ישירות"
 * context (no supplier or customer is created), the link is the ordinary
 * signing link, the messages are the ordinary sends. Fields the office would
 * normally fill are handed to the signer when they are empty.
 *
 * One action, once. The client names each action with an operation id; the
 * tracked row is claimed under that id BEFORE anything else exists, so a
 * second click, a retry after a timeout or two tabs cannot make a second
 * document: they find the claim and get the first attempt's result back
 * (or wait a few seconds for it). A claim whose attempt died is marked
 * failed and a retry picks it up; sends are recorded per attempt in
 * message_sends, never inferred from the document.
 */

export type QuickSendRecipient = { companyId: string } | { name: string; phone?: string | null; email?: string | null; kind: AudienceKind }
export type QuickSendChannel = 'sms' | 'email' | 'whatsapp'

export type QuickSendSuccess = { ok: true; agreementId: string; leadId: string; delivered: boolean; deliveryError: string | null; whatsapp: { sendId: string; url: string; text: string } | null; replayed: boolean }
export type QuickSendResult = QuickSendSuccess | { ok: false; message: string; state?: 'in_progress' }

const STALE_CLAIM_MS = 90_000
const WAIT_FOR_SIBLING_MS = 8_000

export async function quickSend(session: StaffSession, input: { operationId: string; recipient: QuickSendRecipient; templateId: string; channel: QuickSendChannel; ip?: string | null; userAgent?: string | null }): Promise<QuickSendResult> {
  const db = getDb()
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(input.operationId)) return { ok: false, message: 'חסר מזהה פעולה.' }

  // ── who ────────────────────────────────────────────────────────────────
  let companyId: string | null = null
  let companyName: string | null = null
  let kind: AudienceKind | null = null
  let name: string
  let contact: { phone: string | null; email: string | null }
  if ('companyId' in input.recipient) {
    const company = await getCompany(session, input.recipient.companyId)
    if (!company) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }
    companyId = company.id
    companyName = company.name
    kind = company.kind === 'customer' ? 'customer' : 'supplier'
    name = (company.contactName ?? '').trim() || company.name
    const normalized = normalizeContact({ phone: company.contactPhone ?? '', email: company.contactEmail ?? '' })
    if (!normalized.ok) return { ok: false, message: `ל${company.name} אין טלפון או אימייל תקינים. השלימו אותם בכרטיס ונסו שוב.` }
    contact = normalized.contact
  } else {
    name = input.recipient.name.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!name) return { ok: false, message: 'נדרש שם.' }
    kind = input.recipient.kind
    const normalized = normalizeContact({ phone: input.recipient.phone ?? '', email: input.recipient.email ?? '' })
    if (!normalized.ok) return normalized
    contact = normalized.contact
  }
  if (input.channel === 'email' && !contact.email) return { ok: false, message: 'לשליחה באימייל צריך כתובת אימייל.' }
  if (input.channel !== 'email' && !contact.phone) return { ok: false, message: 'לשליחה ב-SMS או ב-WhatsApp צריך מספר טלפון.' }

  // ── the claim: this action, this row, before anything else exists ──────
  const group = await directSigningGroup(session)
  const claim = await claimOperation(session, group.id, input.operationId, { name, contact, kind, companyId, channel: input.channel })
  if (!claim.ok) return claim
  if (claim.replay) return claim.replay
  const leadId = claim.leadId

  try {
    // ── what ─────────────────────────────────────────────────────────────
    const created = await createDocumentFromTemplate({ session, templateId: input.templateId, companyId, unfiled: companyId ? undefined : { name }, ip: input.ip, userAgent: input.userAgent })
    if (!created.ok) return await fail(leadId, created.message)
    const agreementId = created.agreementId

    const recipient = await saveRecipient({ session, agreementId, name, company: companyName, phone: contact.phone, email: contact.email })
    if (!recipient.ok) return await fail(leadId, recipient.message)

    await handEmptyFieldsToSigner(session, agreementId)

    // The document exists: from here a retry replays, never recreates.
    await db.update(schema.projectLeads).set({ agreementId, status: 'converted', lastActivityAt: new Date() }).where(eq(schema.projectLeads.id, leadId))

    // ── how ──────────────────────────────────────────────────────────────
    if (input.channel === 'whatsapp') {
      // The link is minted and the document marked sent; the rep's own phone
      // carries the message. Validation runs as for SMS, which needs the phone.
      const issued = await issueSigningLink({ session, agreementId, channels: ['sms'] })
      if (!issued.ok) return await fail(leadId, issued.blockers.join(' '))
      const text = buildShareMessage({ recipientName: name, signingLink: issued.signingUrl })
      const [send] = await db
        .insert(schema.messageSends)
        .values({ organizationId: session.organizationId, groupId: group.id, agreementId, leadId, sentBy: session.userId, channel: 'whatsapp', event: 'invitation', recipient: contact.phone ?? '', body: text, ok: false, error: null, manualState: 'opened', attemptKey: `${input.operationId}:whatsapp` })
        .returning({ id: schema.messageSends.id })
      return { ok: true, agreementId, leadId, delivered: false, deliveryError: null, whatsapp: { sendId: send.id, url: buildWhatsAppShareUrl({ recipientName: name, signingLink: issued.signingUrl, phoneE164: contact.phone }), text }, replayed: false }
    }

    const sent = await sendAgreement({ session, agreementId, channels: [input.channel] })
    if (!sent.ok) return await fail(leadId, sent.blockers.join(' '))
    // The ordinary send records its rows by agreement; the tracked person gets them too.
    await db.update(schema.messageSends).set({ leadId, sentBy: session.userId, attemptKey: `${input.operationId}:${input.channel}` }).where(and(eq(schema.messageSends.agreementId, agreementId), isNull(schema.messageSends.leadId)))
    const delivery = sent.deliveries.find((d) => d.channel === input.channel)
    return { ok: true, agreementId, leadId, delivered: Boolean(delivery?.sent), deliveryError: delivery?.sent ? null : humanize(delivery?.error), whatsapp: null, replayed: false }
  } catch (error) {
    log.error('quick send failed', { leadId, error: error instanceof Error ? error.message : String(error) })
    return await fail(leadId, 'השליחה נכשלה. נסו שוב.')
  }
}

type ClaimResult = { ok: true; leadId: string; replay: QuickSendSuccess | null } | { ok: false; message: string; state?: 'in_progress' }

/**
 * Insert-or-find under the operation key. A fresh claim proceeds; a claim
 * with a document replays its result; a claim still in flight is waited for;
 * a failed or abandoned claim is taken over by this attempt.
 */
async function claimOperation(session: StaffSession, groupId: string, operationId: string, who: { name: string; contact: { phone: string | null; email: string | null }; kind: AudienceKind | null; companyId: string | null; channel: QuickSendChannel }): Promise<ClaimResult> {
  const db = getDb()
  const idempotencyKey = operationKey(groupId, operationId)
  const inserted = await db
    .insert(schema.projectLeads)
    .values({
      organizationId: session.organizationId,
      groupId,
      status: 'pending',
      data: { name: who.name, phone: who.contact.phone, email: who.contact.email },
      source: 'invitation',
      phone: who.contact.phone,
      email: who.contact.email,
      kind: who.kind,
      invitedBy: session.userId,
      companyId: who.companyId,
      inviteChannel: who.channel,
      idempotencyKey,
      lastActivityAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.projectLeads.id })
  if (inserted[0]) return { ok: true, leadId: inserted[0].id, replay: null }

  const find = async () => (await db.select().from(schema.projectLeads).where(and(eq(schema.projectLeads.groupId, groupId), eq(schema.projectLeads.idempotencyKey, idempotencyKey))).limit(1))[0]
  let row = await find()
  if (!row) return { ok: false, message: 'הפעולה לא נשמרה. נסו שוב.' }

  // Still being made by the first attempt: give it a few seconds.
  const deadline = Date.now() + WAIT_FOR_SIBLING_MS
  while (row.status === 'pending' && !row.agreementId && Date.now() - row.createdAt.getTime() < STALE_CLAIM_MS && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    row = (await find()) ?? row
  }

  if (row.agreementId) return { ok: true, leadId: row.id, replay: await replayResult(session, row.id, row.agreementId, who.channel) }
  if (row.status === 'pending' && Date.now() - row.createdAt.getTime() < STALE_CLAIM_MS) return { ok: false, state: 'in_progress', message: 'השליחה עדיין מתבצעת. עוד רגע.' }

  // Failed or abandoned: this attempt takes the row over. The compare on
  // status makes two late retries race for one winner.
  const taken = await db
    .update(schema.projectLeads)
    .set({ status: 'pending', createdAt: new Date(), lastActivityAt: new Date(), meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) - 'error'` })
    .where(and(eq(schema.projectLeads.id, row.id), eq(schema.projectLeads.status, row.status), isNull(schema.projectLeads.agreementId)))
    .returning({ id: schema.projectLeads.id })
  if (!taken[0]) return { ok: false, state: 'in_progress', message: 'השליחה עדיין מתבצעת. עוד רגע.' }
  return { ok: true, leadId: row.id, replay: null }
}

/** The first attempt's outcome, read back from what it recorded. */
async function replayResult(session: StaffSession, leadId: string, agreementId: string, channel: QuickSendChannel): Promise<QuickSendSuccess> {
  const db = getDb()
  const [last] = await db
    .select({ id: schema.messageSends.id, channel: schema.messageSends.channel, ok: schema.messageSends.ok, error: schema.messageSends.error, body: schema.messageSends.body, recipient: schema.messageSends.recipient })
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.organizationId, session.organizationId), eq(schema.messageSends.leadId, leadId), eq(schema.messageSends.isTest, false)))
    .orderBy(desc(schema.messageSends.sentAt))
    .limit(1)
  if (channel === 'whatsapp' && last?.channel === 'whatsapp') {
    const [lead] = await db.select({ data: schema.projectLeads.data, phone: schema.projectLeads.phone }).from(schema.projectLeads).where(eq(schema.projectLeads.id, leadId)).limit(1)
    const name = ((lead?.data as { name?: string } | null)?.name ?? '').trim()
    const url = buildWhatsAppShareUrl({ recipientName: name, signingLink: '', phoneE164: lead?.phone }).replace(/\?text=.*$/, `?text=${encodeURIComponent(last.body)}`)
    return { ok: true, agreementId, leadId, delivered: false, deliveryError: null, whatsapp: { sendId: last.id, url, text: last.body }, replayed: true }
  }
  return { ok: true, agreementId, leadId, delivered: Boolean(last?.ok), deliveryError: last && !last.ok ? humanize(last.error) : null, whatsapp: null, replayed: true }
}

async function fail(leadId: string, message: string): Promise<QuickSendResult> {
  await getDb()
    .update(schema.projectLeads)
    .set({ status: 'failed', lastActivityAt: new Date(), meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) || ${JSON.stringify({ error: message.slice(0, 300) })}::jsonb` })
    .where(and(eq(schema.projectLeads.id, leadId), isNull(schema.projectLeads.agreementId)))
  return { ok: false, message }
}

/**
 * Fields the office fills that nobody filled: the signer fills them on the
 * signing page instead. Signing still refuses to finish while a required
 * field is empty — that rule is the signing engine's, not this one's.
 */
async function handEmptyFieldsToSigner(session: StaffSession, agreementId: string): Promise<void> {
  const [agreement] = await getDb().select({ versionId: schema.agreements.currentVersionId }).from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1)
  if (!agreement?.versionId) return
  const fields = await loadFields(agreement.versionId)
  const empty = fields.filter((f) => f.ownedBy === 'sender' && f.type !== 'signature' && !(f.value ?? '').trim())
  if (empty.length === 0) return
  const handed = fields.map((f) => (empty.includes(f) ? { ...f, ownedBy: 'signer' as const, required: true } : f))
  const saved = await saveFields({ session, agreementId, fields: handed })
  if (!saved.ok) log.warn('quick send: fields not handed to signer', { agreementId, message: saved.message })
}
