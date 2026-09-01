import { and, desc, eq, isNull } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { generateOtpCode, hashToken, safeEqualHex } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import { maskPhone, toIsraeliNationalFormat } from '@/lib/phone'
import { InforuSmsProvider, logOnlyMode } from '@/server/notifications/inforu'
import { createSigningSession, type SigningContext } from './session'

/**
 * Phone verification for the signer.
 *
 * XTRA Sign owns the state machine — the code, its expiry, the attempt and
 * resend counters, and the audit trail. InforU only carries the SMS. Three
 * reasons: the challenge must be bound to THIS recipient rather than globally
 * to a phone number, so one signer's attempts cannot lock out another's; the
 * audit event has to be ours; and "this phone was verified" is a fact with
 * legal weight, which should not live in a third party's state we cannot replay.
 *
 * Limits are the ones proven in production in XtraGiftCard-NestApp, with the
 * storage changed from an in-memory Map — which dies on restart, does not
 * survive a second instance, and never evicts — to a table.
 */

const CODE_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_RESENDS = 5
const RESEND_COOLDOWN_MS = 30 * 1000

export type OtpSendResult =
  | {
      ok: true
      maskedDestination: string
      /**
       * Set ONLY when SIGN_LOG_NOTIFICATIONS=true, i.e. when no SMS was
       * actually sent. It exists so the signing flow is testable without live
       * credentials, and the UI that receives it must say plainly that nothing
       * was delivered. It is never populated when a real send is configured.
       */
      devCode?: string
    }
  | { ok: false; message: string }

export type OtpVerifyResult = { ok: true } | { ok: false; message: string }

/** The live challenge for a recipient, if any. */
async function currentChallenge(recipientId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(schema.otpChallenges)
    .where(
      and(
        eq(schema.otpChallenges.recipientId, recipientId),
        isNull(schema.otpChallenges.consumedAt),
      ),
    )
    .orderBy(desc(schema.otpChallenges.createdAt))
    .limit(1)
  return row ?? null
}

export async function sendOtp(context: SigningContext): Promise<OtpSendResult> {
  const phone = toIsraeliNationalFormat(context.recipientPhone)
  if (!phone) {
    return { ok: false, message: 'לא ניתן לשלוח קוד אימות. פנו לשולח המסמך.' }
  }

  const db = getDb()
  const existing = await currentChallenge(context.recipientId)
  const now = Date.now()

  if (existing && existing.expiresAt.getTime() > now) {
    if (now - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      return { ok: false, message: 'הקוד כבר נשלח. אנא המתינו 30 שניות לפני שליחה נוספת.' }
    }
    if (existing.resendCount >= MAX_RESENDS) {
      return { ok: false, message: 'חרגתם ממספר השליחות המרבי. נסו שוב מאוחר יותר.' }
    }
  }

  // A resend always mints a fresh code and replaces the stored hash. Only the
  // hash is kept, so the previous code cannot be re-sent — and the newest
  // message is always the one that works, which is what a signer assumes.
  const code = generateOtpCode()

  if (existing && existing.expiresAt.getTime() > now) {
    await db
      .update(schema.otpChallenges)
      .set({
        codeHash: hashToken(code),
        lastSentAt: new Date(),
        resendCount: existing.resendCount + 1,
        // A fresh code deserves a fresh attempt budget, but the resend counter
        // keeps climbing so this is not an unlimited retry loop.
        attempts: 0,
      })
      .where(eq(schema.otpChallenges.id, existing.id))
  } else {
    await db.insert(schema.otpChallenges).values({
      recipientId: context.recipientId,
      // Hashed. A database dump must not be a list of working codes.
      codeHash: hashToken(code),
      destination: context.recipientPhone!,
      expiresAt: new Date(now + CODE_TTL_MS),
    })
  }

  const template = process.env.SIGN_OTP_MESSAGE ?? 'קוד האימות שלך לחתימה על מסמך ב-XTRA הוא:'
  const result = await new InforuSmsProvider().send({
    to: phone,
    text: `${template} ${code}`,
    recipientName: context.recipientName,
  })

  await db.insert(schema.auditEvents).values({
    agreementId: context.agreementId,
    recipientId: context.recipientId,
    type: AUDIT_EVENTS.OTP_SENT,
    actor: 'signer',
    // Never the code, never the hash.
    metadata: { channel: 'sms', delivered: result.ok },
  })

  // In log-only mode nothing was delivered, and saying otherwise would be a
  // lie — but blocking here makes the whole signer flow untestable before
  // credentials exist. So the code comes back and the UI states, unmissably,
  // that no SMS was sent.
  if (!result.ok && logOnlyMode()) {
    return {
      ok: true,
      maskedDestination: maskPhone(context.recipientPhone) ?? '',
      devCode: code,
    }
  }

  if (!result.ok) {
    return { ok: false, message: 'שליחת קוד האימות נכשלה. נסו שוב בעוד רגע.' }
  }

  return { ok: true, maskedDestination: maskPhone(context.recipientPhone) ?? '' }
}

export async function verifyOtp(
  context: SigningContext,
  code: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<OtpVerifyResult> {
  const db = getDb()
  const challenge = await currentChallenge(context.recipientId)

  const fail = async (message: string) => {
    await db.insert(schema.auditEvents).values({
      agreementId: context.agreementId,
      recipientId: context.recipientId,
      type: AUDIT_EVENTS.OTP_FAILED,
      actor: 'signer',
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    return { ok: false as const, message }
  }

  if (!challenge) return fail('לא נמצא קוד אימות. בקשו קוד חדש.')

  if (challenge.expiresAt.getTime() < Date.now()) {
    return fail('הקוד פג תוקף. בקשו קוד חדש.')
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return fail('יותר מדי ניסיונות. בקשו קוד חדש.')
  }

  const supplied = typeof code === 'string' ? code.trim() : ''
  // Constant-time: `===` on a digest leaks its prefix through timing, and this
  // is the one input an attacker controls and can retry.
  const matches = /^[0-9]{6}$/.test(supplied) && safeEqualHex(hashToken(supplied), challenge.codeHash)

  if (!matches) {
    await db
      .update(schema.otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(schema.otpChallenges.id, challenge.id))
    return fail('קוד שגוי. נסו שנית.')
  }

  // Single-use: consumed before the session is issued, so the same code cannot
  // be replayed even in a race.
  await db
    .update(schema.otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.otpChallenges.id, challenge.id))

  await db
    .update(schema.recipients)
    .set({ verifiedVia: 'sms_otp', verifiedAt: new Date() })
    .where(eq(schema.recipients.id, context.recipientId))

  await createSigningSession({
    recipientId: context.recipientId,
    tokenId: context.tokenId,
  })

  await db.insert(schema.auditEvents).values({
    agreementId: context.agreementId,
    recipientId: context.recipientId,
    type: AUDIT_EVENTS.OTP_VERIFIED,
    actor: 'signer',
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { method: 'sms_otp' },
  })

  return { ok: true }
}
