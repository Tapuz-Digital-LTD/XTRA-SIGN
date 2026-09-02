import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import { notify } from '@/server/notifications/notifications'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import type { NotificationProvider } from '@/server/notifications/types'
import { authorizeAgreementAccess } from './authorization'
import { buildSendSummary, type Channel } from './send-validation'

/**
 * Sends a document for signature.
 *
 * Order matters: the token and the status change are committed before any
 * message goes out. A delivery that fails leaves a live, resendable request; a
 * message that goes out before the token exists would carry a dead link.
 */

const SIGNING_LINK_TTL_DAYS = 30

export type SendResult =
  | {
      ok: true
      signingUrl: string
      deliveries: { channel: Channel; sent: boolean; error?: string }[]
    }
  | { ok: false; blockers: string[] }

export async function sendAgreement(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
}): Promise<SendResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status !== 'draft') {
    return { ok: false, blockers: ['המסמך כבר נשלח.'] }
  }

  const summary = await buildSendSummary(
    agreement.id,
    agreement.currentVersionId,
    input.channels,
    true,
  )
  if (!summary.canSend) return { ok: false, blockers: summary.blockers }

  const db = getDb()

  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  if (!recipient) throw new ForbiddenError()

  // 32 bytes of CSPRNG. Only the hash is stored, so a database dump is not a
  // set of working signing links.
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SIGNING_LINK_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.transaction(async (tx) => {
    await tx.insert(schema.signingTokens).values({
      recipientId: recipient.id,
      tokenHash: hashToken(token),
      expiresAt,
    })

    await tx
      .update(schema.agreements)
      .set({ status: 'sent', sentAt: new Date(), expiresAt })
      .where(eq(schema.agreements.id, agreement.id))

    await tx.insert(schema.auditEvents).values({
      agreementId: agreement.id,
      recipientId: recipient.id,
      type: AUDIT_EVENTS.SENT,
      actor: input.session.email,
      // Never the token itself.
      metadata: { channels: input.channels },
    })
  })

  const signingUrl = buildSigningUrl(token)

  const deliveries: { channel: Channel; sent: boolean; error?: string }[] = []
  for (const channel of input.channels) {
    deliveries.push(
      await deliver({
        channel,
        agreementId: agreement.id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        to: channel === 'sms' ? (recipient.phone ?? '') : (recipient.email ?? ''),
        documentTitle: agreement.title,
        signingUrl,
        actor: input.session.email,
      }),
    )
  }

  return { ok: true, signingUrl, deliveries }
}

export function buildSigningUrl(token: string): string {
  const base = (process.env.SIGN_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/sign/${token}`
}

/**
 * One channel. Records a Delivery either way, so a failure is visible on the
 * document rather than only in a log.
 */
async function deliver(input: {
  channel: Channel
  agreementId: string
  recipientId: string
  recipientName: string
  to: string
  documentTitle: string
  signingUrl: string
  actor: string
}) {
  const db = getDb()
  const provider: NotificationProvider =
    input.channel === 'sms' ? new InforuSmsProvider() : new InforuEmailProvider()

  const message =
    input.channel === 'sms'
      ? {
          to: input.to,
          text: `שלום ${input.recipientName}, מחכה לך מסמך לחתימה מ-XTRA: ${input.signingUrl}`,
          recipientName: input.recipientName,
        }
      : {
          to: input.to,
          subject: `מסמך לחתימה: ${input.documentTitle}`,
          text: `שלום ${input.recipientName}, מחכה לך מסמך לחתימה: ${input.signingUrl}`,
          html: emailHtml(input.recipientName, input.documentTitle, input.signingUrl),
          recipientName: input.recipientName,
        }

  const result = await provider.send(message)

  await db.insert(schema.deliveries).values({
    agreementId: input.agreementId,
    recipientId: input.recipientId,
    channel: input.channel,
    provider: 'inforu',
    providerMessageId: result.providerMessageId,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
    sentAt: result.ok ? new Date() : null,
    failedAt: result.ok ? null : new Date(),
  })

  await db.insert(schema.auditEvents).values({
    agreementId: input.agreementId,
    recipientId: input.recipientId,
    type: result.ok
      ? input.channel === 'sms'
        ? AUDIT_EVENTS.SMS_SENT
        : AUDIT_EVENTS.EMAIL_SENT
      : input.channel === 'sms'
        ? AUDIT_EVENTS.SMS_FAILED
        : AUDIT_EVENTS.EMAIL_FAILED,
    actor: input.actor,
    metadata: {
      providerMessageId: result.providerMessageId,
      ...(result.ok ? {} : { error: result.error }),
    },
  })

  if (!result.ok) {
    // The operator has to learn about this somewhere other than the audit log:
    // a failed send looks exactly like a signer who has not got round to it.
    const [row] = await db
      .select({ organizationId: schema.agreements.organizationId, title: schema.agreements.title })
      .from(schema.agreements)
      .where(eq(schema.agreements.id, input.agreementId))
      .limit(1)
    if (row) {
      await notify({
        organizationId: row.organizationId,
        type: 'send_failed',
        agreementId: input.agreementId,
        title: `השליחה של "${row.title}" נכשלה`,
        body: input.channel === 'sms' ? 'שליחה ב-SMS' : 'שליחה באימייל',
      })
    }
  }

  return {
    channel: input.channel,
    sent: result.ok,
    error: result.ok ? undefined : result.error,
  }
}

/** Inline styles only: every mail client strips a stylesheet. */
function emailHtml(name: string, title: string, url: string): string {
  const safe = (value: string) =>
    value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e5e7;border-radius:12px;padding:32px">
<tr><td style="text-align:right;color:#0f172a;font-size:16px;line-height:1.6">
<p style="margin:0 0 8px">שלום ${safe(name)},</p>
<p style="margin:0 0 24px;font-size:18px;font-weight:bold">מחכה לך מסמך לחתימה</p>
<p style="margin:0 0 24px;color:#64748b">${safe(title)}</p>
<a href="${safe(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold">לצפייה וחתימה</a>
<p style="margin:24px 0 0;font-size:12px;color:#64748b">הקישור אישי ואינו מיועד להעברה.</p>
</td></tr></table></td></tr></table></body></html>`
}

/** Resends the same request on the same link, without creating a new one. */
export async function resendAgreement(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
}): Promise<{ ok: boolean; message?: string }> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (!['sent', 'viewed'].includes(agreement.status)) {
    return { ok: false, message: 'ניתן לשלוח תזכורת רק למסמך שממתין לחתימה.' }
  }

  const db = getDb()
  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  if (!recipient) return { ok: false, message: 'לא נמצא חותם.' }

  const [existing] = await db
    .select()
    .from(schema.signingTokens)
    .where(eq(schema.signingTokens.recipientId, recipient.id))
    .limit(1)

  if (!existing) return { ok: false, message: 'לא נמצא קישור חתימה פעיל.' }

  // The raw token was never stored, so the original URL cannot be rebuilt to
  // put in the reminder. The token is rotated in place — same row, so a signer
  // who already verified keeps their session (it is bound to the row, not the
  // URL) — and the fresh link is the one sent. The previously sent URL stops
  // resolving, matching the "newest message is the one that works" rule the
  // OTP resends use. This is why a reminder is a deliberate action, not silent.
  const token = generateToken()
  await db
    .update(schema.signingTokens)
    .set({ tokenHash: hashToken(token), expiresAt: existing.expiresAt })
    .where(eq(schema.signingTokens.id, existing.id))

  const signingUrl = buildSigningUrl(token)

  for (const channel of input.channels) {
    await deliver({
      channel,
      agreementId: agreement.id,
      recipientId: recipient.id,
      recipientName: recipient.name,
      to: channel === 'sms' ? (recipient.phone ?? '') : (recipient.email ?? ''),
      documentTitle: agreement.title,
      signingUrl,
      actor: input.session.email,
    })
  }

  await db.insert(schema.auditEvents).values({
    agreementId: agreement.id,
    recipientId: recipient.id,
    type: AUDIT_EVENTS.REMINDER_SENT,
    actor: input.session.email,
    metadata: { channels: input.channels },
  })

  return { ok: true }
}
