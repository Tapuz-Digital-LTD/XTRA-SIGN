import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { buildShareMessage, buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import { getCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { loadFields, saveFields, saveRecipient } from '@/server/documents/save-fields'
import { issueSigningLink, sendAgreement } from '@/server/documents/send-agreement'
import { createInvitation, directSigningGroup, humanSendError, normalizeContact, type AudienceKind } from '@/server/invitations/invitations'
import { log } from '@/server/log'
import { createDocumentFromTemplate } from '@/server/templates/templates'

/**
 * "שלח מסמך לחתימה": name + phone → document → channel → sent.
 *
 * The same pieces a campaign uses, in one call: the document comes from the
 * template, the person is a tracked row under the internal "חתימות ישירות"
 * context (no supplier or customer is created), the link is the ordinary
 * signing link, the messages are the ordinary sends. Fields the office would
 * normally fill are handed to the signer when they are empty — the signer
 * cannot finish without them, but the sender is never made to fill them for
 * a person they only know by name.
 */

export type QuickSendRecipient = { companyId: string } | { name: string; phone?: string | null; email?: string | null; kind: AudienceKind }
export type QuickSendChannel = 'sms' | 'email' | 'whatsapp'

export type QuickSendResult =
  | { ok: true; agreementId: string; leadId: string; delivered: boolean; deliveryError: string | null; whatsapp: { sendId: string; url: string; text: string } | null }
  | { ok: false; message: string }

export async function quickSend(session: StaffSession, input: { recipient: QuickSendRecipient; templateId: string; channel: QuickSendChannel; ip?: string | null; userAgent?: string | null }): Promise<QuickSendResult> {
  const db = getDb()

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

  // ── what ───────────────────────────────────────────────────────────────
  const created = await createDocumentFromTemplate({ session, templateId: input.templateId, companyId, unfiled: companyId ? undefined : { name }, ip: input.ip, userAgent: input.userAgent })
  if (!created.ok) return { ok: false, message: created.message }
  const agreementId = created.agreementId

  const recipient = await saveRecipient({ session, agreementId, name, company: companyName, phone: contact.phone, email: contact.email })
  if (!recipient.ok) return { ok: false, message: recipient.message }

  await handEmptyFieldsToSigner(session, agreementId)

  // ── tracked person ─────────────────────────────────────────────────────
  const group = await directSigningGroup(session)
  const invitation = await createInvitation(session, { groupId: group.id, name, phone: contact.phone, email: contact.email, kind, companyId, agreementId })
  if (!invitation.ok) return { ok: false, message: invitation.message }
  const leadId = invitation.invitation.id

  // ── how ────────────────────────────────────────────────────────────────
  if (input.channel === 'whatsapp') {
    // The link is minted and the document marked sent; the rep's own phone
    // carries the message. Validation runs as for SMS, which needs the phone.
    const issued = await issueSigningLink({ session, agreementId, channels: ['sms'] })
    if (!issued.ok) return { ok: false, message: issued.blockers.join(' ') }
    const text = buildShareMessage({ recipientName: name, signingLink: issued.signingUrl })
    const [send] = await db
      .insert(schema.messageSends)
      .values({ organizationId: session.organizationId, groupId: group.id, agreementId, leadId, sentBy: session.userId, channel: 'whatsapp', event: 'invitation', recipient: contact.phone ?? '', body: text, ok: false, error: null, manualState: 'opened' })
      .returning({ id: schema.messageSends.id })
    await db.update(schema.projectLeads).set({ inviteChannel: 'whatsapp', lastActivityAt: new Date() }).where(eq(schema.projectLeads.id, leadId))
    return { ok: true, agreementId, leadId, delivered: false, deliveryError: null, whatsapp: { sendId: send.id, url: buildWhatsAppShareUrl({ recipientName: name, signingLink: issued.signingUrl, phoneE164: contact.phone }), text } }
  }

  const sent = await sendAgreement({ session, agreementId, channels: [input.channel] })
  if (!sent.ok) return { ok: false, message: sent.blockers.join(' ') }
  // The ordinary send records its rows by agreement; the tracked person gets them too.
  await db.update(schema.messageSends).set({ leadId, sentBy: session.userId }).where(and(eq(schema.messageSends.agreementId, agreementId), isNull(schema.messageSends.leadId)))
  await db.update(schema.projectLeads).set({ inviteChannel: input.channel, lastActivityAt: new Date() }).where(eq(schema.projectLeads.id, leadId))
  const delivery = sent.deliveries.find((d) => d.channel === input.channel)
  return { ok: true, agreementId, leadId, delivered: Boolean(delivery?.sent), deliveryError: delivery?.sent ? null : humanSendError(delivery?.error), whatsapp: null }
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
