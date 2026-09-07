import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { escapeHtml } from '@/lib/message-template'
import { normalizeIsraeliPhone } from '@/lib/phone'
import { AUDIT_EVENTS } from '@/server/audit'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { campaignFor, resendAgreement } from '@/server/documents/send-agreement'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { projectNotificationSettings } from '@/server/projects/notification-settings'
import { getStorage } from '@/server/storage/blob'
import { attentionForAgreements, EMAIL_RE } from './attention'

/**
 * Sending one failed message again — and only that message.
 *
 * Nothing new is made here: no agreement, no PDF, no registration. The signed
 * copy goes out again from its snapshot (the words that failed to leave); a
 * message that carries the signing link is re-issued through the ordinary
 * resend, because the link inside an old snapshot may have been rotated since.
 */

const LINK_EVENTS = new Set(['invitation', 'reminder', 'registration_completed'])

export type ResendResult =
  | { ok: true; state: 'sent'; sendId: string }
  | { ok: false; state: 'already_sent' | 'not_found' | 'canceled' | 'not_open' | 'link_expired' | 'invalid_recipient' | 'failed'; message: string; sendId?: string }

export async function resendFailedMessage(
  session: StaffSession,
  input: { agreementId: string; sendId: string; to?: string },
): Promise<ResendResult> {
  const agreement = await authorizeAgreementAccess(session, input.agreementId)
  const db = getDb()

  const [send] = await db
    .select()
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.id, input.sendId), eq(schema.messageSends.agreementId, agreement.id), eq(schema.messageSends.organizationId, session.organizationId)))
    .limit(1)
  if (!send) return { ok: false, state: 'not_found', message: 'ההודעה לא נמצאה.' }
  // WhatsApp is a share from the rep's phone, not a send the server can repeat.
  if (send.channel === 'whatsapp') return { ok: false, state: 'failed', message: 'WhatsApp נשלח מהטלפון של הנציג. פתחו את השיתוף מדף ההסכם.' }
  if (agreement.status === 'canceled') return { ok: false, state: 'canceled', message: 'ההסכם בוטל, ואין מה לשלוח.' }
  const channel = send.channel === 'sms' ? 'sms' : 'email'

  // The newest row of this message on this channel decides: once one went
  // out fine, a second click must not send it twice.
  const [latest] = await db
    .select({ id: schema.messageSends.id, ok: schema.messageSends.ok, sentAt: schema.messageSends.sentAt })
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.agreementId, agreement.id), eq(schema.messageSends.event, send.event), eq(schema.messageSends.channel, send.channel), eq(schema.messageSends.isTest, false)))
    .orderBy(desc(schema.messageSends.sentAt))
    .limit(1)
  if (latest && latest.ok && latest.sentAt > send.sentAt) return { ok: false, state: 'already_sent', message: 'ההודעה כבר נשלחה בהצלחה.', sendId: latest.id }

  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id)).limit(1)
  if (!recipient) return { ok: false, state: 'not_found', message: 'לא נמצא חותם.' }

  let to: string
  if (input.to !== undefined) {
    const cleaned = channel === 'sms' ? normalizeIsraeliPhone(input.to) : EMAIL_RE.test(input.to.trim()) ? input.to.trim() : null
    if (!cleaned) return { ok: false, state: 'invalid_recipient', message: channel === 'sms' ? 'מספר הטלפון אינו תקין.' : 'כתובת המייל אינה תקינה.' }
    await db.update(schema.recipients).set(channel === 'sms' ? { phone: cleaned } : { email: cleaned }).where(eq(schema.recipients.id, recipient.id))
    to = cleaned
  } else {
    to = (channel === 'sms' ? recipient.phone : recipient.email) ?? send.recipient
    const valid = channel === 'sms' ? Boolean(normalizeIsraeliPhone(to)) : EMAIL_RE.test(to)
    if (!valid) return { ok: false, state: 'invalid_recipient', message: channel === 'sms' ? 'מספר הטלפון אינו תקין. תקנו אותו ושלחו שוב.' : 'כתובת המייל אינה תקינה. תקנו אותה ושלחו שוב.' }
  }

  if (LINK_EVENTS.has(send.event)) {
    if (agreement.status !== 'sent' && agreement.status !== 'viewed') return { ok: false, state: 'not_open', message: 'ההסכם כבר לא ממתין לחתימה.' }
    const [row] = await db.select({ expiresAt: schema.agreements.expiresAt }).from(schema.agreements).where(eq(schema.agreements.id, agreement.id)).limit(1)
    if (row?.expiresAt && row.expiresAt < new Date()) return { ok: false, state: 'link_expired', message: 'קישור החתימה פג. חדשו את הקישור במקום.' }
    const result = await resendAgreement({ session, agreementId: agreement.id, channels: [channel], kind: send.event === 'reminder' ? 'reminder' : 'resend' })
    if (!result.ok) return { ok: false, state: 'failed', message: result.message ?? 'השליחה נכשלה.' }
    const [fresh] = await db
      .select({ id: schema.messageSends.id, ok: schema.messageSends.ok })
      .from(schema.messageSends)
      .where(and(eq(schema.messageSends.agreementId, agreement.id), eq(schema.messageSends.channel, channel), eq(schema.messageSends.isTest, false)))
      .orderBy(desc(schema.messageSends.sentAt))
      .limit(1)
    if (!fresh || fresh.id === send.id) return { ok: false, state: 'failed', message: 'השליחה לא נרשמה.' }
    await db.update(schema.messageSends).set({ retryOf: send.id, sentBy: session.userId }).where(eq(schema.messageSends.id, fresh.id))
    return fresh.ok ? { ok: true, state: 'sent', sendId: fresh.id } : { ok: false, state: 'failed', message: 'השליחה נכשלה שוב.', sendId: fresh.id }
  }

  // The signed copy (or anything else that is not a link): the same words again.
  const result =
    channel === 'sms'
      ? await new InforuSmsProvider().send({ to, text: send.body, recipientName: recipient.name })
      : await sendSnapshotEmail({ agreementId: agreement.id, versionId: agreement.currentVersionId, event: send.event, to, subject: send.subject ?? '', text: send.body, recipientName: recipient.name })

  const [row] = await db
    .insert(schema.messageSends)
    .values({
      organizationId: session.organizationId,
      groupId: send.groupId,
      agreementId: agreement.id,
      leadId: send.leadId,
      channel,
      event: send.event,
      recipient: to,
      subject: send.subject,
      body: send.body,
      variables: send.variables,
      providerMessageId: result.providerMessageId,
      ok: result.ok,
      error: result.ok ? null : result.error,
      sentBy: session.userId,
      retryOf: send.id,
    })
    .returning({ id: schema.messageSends.id })
  await db.insert(schema.auditEvents).values({
    agreementId: agreement.id,
    recipientId: recipient.id,
    type: result.ok ? (channel === 'sms' ? AUDIT_EVENTS.SMS_SENT : AUDIT_EVENTS.EMAIL_SENT) : channel === 'sms' ? AUDIT_EVENTS.SMS_FAILED : AUDIT_EVENTS.EMAIL_FAILED,
    actor: session.email,
    metadata: { purpose: send.event === 'signed_confirmation' ? 'signed_copy' : send.event, retryOf: send.id, ...(result.ok ? {} : { error: result.error }) },
  })
  return result.ok ? { ok: true, state: 'sent', sendId: row.id } : { ok: false, state: 'failed', message: 'השליחה נכשלה שוב.', sendId: row.id }
}

/** The snapshot's text as an email body; the signed PDF attached when the project asks for it. */
async function sendSnapshotEmail(input: { agreementId: string; versionId: string | null; event: string; to: string; subject: string; text: string; recipientName: string }) {
  const campaign = input.event === 'signed_confirmation' ? await campaignFor(input.agreementId) : null
  const copy = campaign ? (await projectNotificationSettings(campaign.id))?.signerCopy : null
  let attachments: { name: string; contentType: string; data: Buffer }[] | undefined
  if (copy?.attachPdf && input.versionId) {
    const [version] = await getDb().select({ signedFileKey: schema.agreementVersions.signedFileKey }).from(schema.agreementVersions).where(eq(schema.agreementVersions.id, input.versionId)).limit(1)
    if (version?.signedFileKey) attachments = [{ name: `${input.subject || 'document'}.pdf`, contentType: 'application/pdf', data: await getStorage().get(version.signedFileKey) }]
  }
  // ponytail: the plain-text snapshot, kept readable; the branded layout is not re-rendered.
  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.75;white-space:pre-wrap">${escapeHtml(input.text)}</div>`
  return new InforuEmailProvider().send({ to: input.to, subject: input.subject, text: input.text, html, recipientName: input.recipientName, replyTo: copy?.replyTo ?? undefined, fromName: copy?.senderName ?? undefined, attachments })
}

/** A failure a person handled by hand — a phone call, a printed copy — leaves the tab with a note. */
export async function resolveFailure(session: StaffSession, input: { sendId: string; note: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getDb()
  const [send] = await db
    .select({ id: schema.messageSends.id, agreementId: schema.messageSends.agreementId })
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.id, input.sendId), eq(schema.messageSends.organizationId, session.organizationId)))
    .limit(1)
  if (!send?.agreementId) return { ok: false, message: 'ההודעה לא נמצאה.' }
  await authorizeAgreementAccess(session, send.agreementId)
  await db
    .update(schema.messageSends)
    .set({ resolvedAt: new Date(), resolvedBy: session.userId, resolvedNote: input.note.trim().slice(0, 300) || null })
    .where(eq(schema.messageSends.id, send.id))
  return { ok: true }
}

export type BulkPreview = { eligible: number; skipped: { agreementId: string; why: string }[] }
export type BulkResult = { sent: number; failed: number; skipped: { agreementId: string; why: string }[] }

/** "שלח שוב הודעות שנכשלו": one resend per agreement, the worst first, addresses that need fixing left alone. */
export async function bulkResendFailed(session: StaffSession, input: { agreementIds: string[]; preview: true }): Promise<BulkPreview>
export async function bulkResendFailed(session: StaffSession, input: { agreementIds: string[]; preview: false }): Promise<BulkResult>
export async function bulkResendFailed(session: StaffSession, input: { agreementIds: string[]; preview: boolean }): Promise<BulkPreview | BulkResult> {
  const ids = [...new Set(input.agreementIds)].slice(0, 100)
  const db = getDb()
  const visible = ids.length
    ? await db
        .select({ id: schema.agreements.id })
        .from(schema.agreements)
        .where(and(inArray(schema.agreements.id, ids), eq(schema.agreements.organizationId, session.organizationId), isNull(schema.agreements.deletedAt), ...(session.isAdmin ? [] : [eq(schema.agreements.ownerId, session.userId)])))
    : []
  const reasons = await attentionForAgreements(session.organizationId, visible.map((v) => v.id))

  const eligible: { agreementId: string; sendId: string }[] = []
  const skipped: { agreementId: string; why: string }[] = []
  for (const id of ids) {
    if (!visible.some((v) => v.id === id)) {
      skipped.push({ agreementId: id, why: 'ההסכם אינו זמין.' })
      continue
    }
    const list = reasons.get(id) ?? []
    // ponytail: one message per agreement per run; a second failed channel gets the next run.
    const resend = list.find((r) => r.action.kind === 'resend_message' && r.action.sendId && r.action.channel !== 'whatsapp')
    if (resend) {
      eligible.push({ agreementId: id, sendId: resend.action.sendId! })
      continue
    }
    const fix = list.find((r) => r.key === 'invalid_email' || r.key === 'invalid_phone')
    const whatsapp = list.some((r) => r.action.channel === 'whatsapp')
    skipped.push({ agreementId: id, why: fix ? (fix.key === 'invalid_email' ? 'יש לתקן את כתובת המייל קודם.' : 'יש לתקן את מספר הטלפון קודם.') : whatsapp ? 'WhatsApp נשלח ידנית מדף ההסכם.' : 'אין הודעה שנכשלה שאפשר לשלוח שוב.' })
  }
  if (input.preview) return { eligible: eligible.length, skipped }

  let sent = 0
  let failed = 0
  for (const item of eligible) {
    const result = await resendFailedMessage(session, item)
    if (result.ok) sent += 1
    else failed += 1
  }
  return { sent, failed, skipped }
}
