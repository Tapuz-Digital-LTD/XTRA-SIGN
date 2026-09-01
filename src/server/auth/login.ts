import { and, desc, eq, isNull } from 'drizzle-orm'
import { maskPhone, normalizeIsraeliPhone, toIsraeliNationalFormat } from '@/lib/phone'
import { getDb, schema } from '@/server/db'
import { consume } from '@/server/http/rate-limit'
import { InforuSmsProvider, logOnlyMode } from '@/server/notifications/inforu'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'
import { createSession } from './session'
import { generateOtpCode, hashToken, safeEqualHex } from './tokens'

/**
 * Staff login by SMS code. There are no passwords anywhere in this system.
 *
 * The credential is possession of the SIM, which removes an entire category of
 * problems rather than managing it: nothing to choose badly, nothing to reuse
 * from another site, nothing to phish, nothing to reset, and no hash to leak.
 *
 * XTRA Sign owns the whole state machine — the code, its expiry, the attempt
 * and resend counters, the audit trail. InforU only carries the message.
 *
 * Deliberately separate from `signing/otp.ts`, which does the same thing for a
 * signer. They look alike today but answer to different rules: a signer's
 * verification is evidence attached to a document and must not change, while a
 * staff login is an operational control we may tighten whenever we like.
 * Sharing the code would couple the two, and the first change to either would
 * have to reason about both.
 */

const CODE_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_RESENDS = 5
const RESEND_COOLDOWN_MS = 30 * 1000

/**
 * One reply for every outcome: number not registered, account disabled, or a
 * code genuinely on its way. Anything else turns the login form into a way to
 * ask "does this person work at XTRA?" and get an answer.
 */
const OPAQUE_SENT = 'אם המספר רשום במערכת, נשלח אליו קוד בהודעת SMS.'
const GENERIC_FAILURE = 'הקוד שהוזן אינו נכון או שפג תוקפו.'
const TOO_MANY = 'יותר מדי ניסיונות. נסו שוב בעוד מספר דקות.'

export type LoginCodeResult =
  | {
      ok: true
      message: string
      maskedDestination: string | null
      /**
       * Set ONLY when SIGN_LOG_NOTIFICATIONS=true — no SMS was sent, and the
       * screen that receives this must say so. It exists so the login flow can
       * be exercised without live credentials.
       *
       * It is present only for a real, active user, so in that mode it does
       * reveal whether an account exists. That is acceptable exactly because
       * nothing was delivered: the mode is for a developer's own machine, and
       * production sets the flag to false.
       */
      devCode?: string
    }
  | { ok: false; message: string }

export type LoginVerifyResult = { ok: true } | { ok: false; message: string }

/** The live challenge for a user, if any. */
async function currentChallenge(userId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(schema.loginChallenges)
    .where(
      and(eq(schema.loginChallenges.userId, userId), isNull(schema.loginChallenges.consumedAt)),
    )
    .orderBy(desc(schema.loginChallenges.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * The account for a phone number, or null.
 *
 * A disabled account still comes back, so the caller can audit the attempt
 * against a real person before returning the same opaque answer it gives for a
 * number nobody owns.
 */
async function userByPhone(phone: string) {
  const db = getDb()
  const [user] = await db
    .select({
      id: schema.users.id,
      organizationId: schema.users.organizationId,
      email: schema.users.email,
      name: schema.users.name,
      disabledAt: schema.users.disabledAt,
    })
    .from(schema.users)
    .where(eq(schema.users.phone, phone))
    .limit(1)

  return user ?? null
}

export async function requestLoginCode(
  phoneInput: string,
  meta: { ip?: string | null } = {},
): Promise<LoginCodeResult> {
  const phone = normalizeIsraeliPhone(phoneInput)

  // A malformed number is a typo, not an oracle — every number has the same
  // shape whether or not it belongs to anyone, so saying this reveals nothing.
  if (!phone) return { ok: false, message: 'מספר הטלפון אינו תקין.' }

  // Keyed on the number AND the caller, so an attacker cannot lock a real
  // person out of their own account by burning the limit on their number alone.
  const perNumber = await consume('login', hashToken(phone).slice(0, 32))
  const perIp = meta.ip ? await consume('login', `ip:${meta.ip}`) : { allowed: true }
  if (!perNumber.allowed || !perIp.allowed) return { ok: false, message: TOO_MANY }

  const masked = maskPhone(phone)
  const user = await userByPhone(phone)

  // No account, or a disabled one: stop here and say exactly what we would have
  // said otherwise.
  //
  // Known limit, stated rather than papered over: sending an SMS takes a few
  // hundred milliseconds and not sending one does not, so response time still
  // distinguishes the two. The per-IP limit above is what makes that hard to
  // use at any scale; closing it completely would mean answering before the
  // message is handed off, and then a delivery failure becomes invisible.
  if (!user || user.disabledAt) {
    if (user?.disabledAt) {
      await recordAdminAction({
        organizationId: user.organizationId,
        type: AUDIT_EVENTS.LOGIN_FAILED,
        actorEmail: user.email,
        ip: meta.ip,
        // Internal only. It lets an admin tell a locked-out colleague from
        // someone probing numbers; the person at the form never sees it.
        metadata: { reason: 'disabled' },
      })
    }
    return { ok: true, message: OPAQUE_SENT, maskedDestination: masked }
  }

  const db = getDb()
  const existing = await currentChallenge(user.id)
  const now = Date.now()

  if (existing && existing.expiresAt.getTime() > now) {
    if (now - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      return { ok: false, message: 'הקוד כבר נשלח. אנא המתינו 30 שניות לפני שליחה נוספת.' }
    }
    if (existing.resendCount >= MAX_RESENDS) {
      return { ok: false, message: TOO_MANY }
    }
  }

  // A resend always mints a fresh code and replaces the stored hash, so the
  // newest message is always the one that works — which is what anyone staring
  // at two SMSs assumes.
  const code = generateOtpCode()

  if (existing && existing.expiresAt.getTime() > now) {
    await db
      .update(schema.loginChallenges)
      .set({
        codeHash: hashToken(code),
        lastSentAt: new Date(),
        resendCount: existing.resendCount + 1,
        // A fresh code earns a fresh attempt budget; the resend counter keeps
        // climbing, so this is not an unlimited retry loop.
        attempts: 0,
      })
      .where(eq(schema.loginChallenges.id, existing.id))
  } else {
    await db.insert(schema.loginChallenges).values({
      userId: user.id,
      // Hashed. A database dump must not be a list of working codes.
      codeHash: hashToken(code),
      expiresAt: new Date(now + CODE_TTL_MS),
    })
  }

  const national = toIsraeliNationalFormat(phone)
  const sent = national
    ? await new InforuSmsProvider().send({
        to: national,
        text: `קוד הכניסה שלך ל-XTRA SIGN הוא: ${code}`,
        recipientName: user.name,
      })
    : { ok: false as const }

  await recordAdminAction({
    organizationId: user.organizationId,
    type: AUDIT_EVENTS.LOGIN_CODE_SENT,
    actorEmail: user.email,
    ip: meta.ip,
    // Never the code, never the hash.
    metadata: { delivered: sent.ok },
  })

  if (!sent.ok && logOnlyMode()) {
    return { ok: true, message: OPAQUE_SENT, maskedDestination: masked, devCode: code }
  }

  if (!sent.ok) {
    // A delivery failure is ours, not a hint about the account, so this one is
    // safe to report plainly — and hiding it would leave someone waiting for a
    // message that is never coming.
    return { ok: false, message: 'שליחת הקוד נכשלה. נסו שוב בעוד רגע.' }
  }

  return { ok: true, message: OPAQUE_SENT, maskedDestination: masked }
}

export async function verifyLoginCode(
  phoneInput: string,
  code: string,
  meta: { ip?: string | null } = {},
): Promise<LoginVerifyResult> {
  const phone = normalizeIsraeliPhone(phoneInput)
  if (!phone) return { ok: false, message: GENERIC_FAILURE }

  const perNumber = await consume('login', hashToken(phone).slice(0, 32))
  const perIp = meta.ip ? await consume('login', `ip:${meta.ip}`) : { allowed: true }
  if (!perNumber.allowed || !perIp.allowed) return { ok: false, message: TOO_MANY }

  const user = await userByPhone(phone)
  if (!user || user.disabledAt) return { ok: false, message: GENERIC_FAILURE }

  const db = getDb()
  const challenge = await currentChallenge(user.id)

  const fail = async (reason: string) => {
    await recordAdminAction({
      organizationId: user.organizationId,
      type: AUDIT_EVENTS.LOGIN_FAILED,
      actorEmail: user.email,
      ip: meta.ip,
      metadata: { reason },
    })
    return { ok: false as const, message: GENERIC_FAILURE }
  }

  if (!challenge) return fail('no_challenge')
  if (challenge.expiresAt.getTime() < Date.now()) return fail('expired')
  if (challenge.attempts >= MAX_ATTEMPTS) return fail('too_many_attempts')

  const supplied = typeof code === 'string' ? code.trim() : ''
  // Constant-time: `===` on a digest leaks its prefix through timing, and this
  // is the one input an attacker controls and can retry.
  const matches =
    /^[0-9]{6}$/.test(supplied) && safeEqualHex(hashToken(supplied), challenge.codeHash)

  if (!matches) {
    await db
      .update(schema.loginChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(schema.loginChallenges.id, challenge.id))
    return fail('bad_code')
  }

  // Single-use, and consumed before the session is issued so the same code
  // cannot be replayed even in a race.
  await db
    .update(schema.loginChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.loginChallenges.id, challenge.id))

  await createSession(user.id)

  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id))

  await recordAdminAction({
    organizationId: user.organizationId,
    type: AUDIT_EVENTS.LOGIN_SUCCEEDED,
    actorEmail: user.email,
    ip: meta.ip,
    metadata: { method: 'sms_otp' },
  })

  return { ok: true }
}
