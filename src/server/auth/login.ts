import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { consume } from '@/server/http/rate-limit'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'
import { createSession } from './session'
import { hashToken, verifyPassword } from './tokens'

/**
 * Verifies credentials and opens a session.
 *
 * One opaque failure for every reason: unknown address, wrong password,
 * disabled account, invitation never accepted. Distinguishing them turns the
 * form into an account-enumeration oracle, and "your account is disabled" tells
 * an attacker the address is real.
 */

/**
 * A well-formed scrypt hash that no password matches.
 *
 * The missing-user path still runs a full verify against it, so a request for
 * an address that does not exist takes about as long as one that does. Without
 * it, response time answers the question the error message refuses to.
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`

const GENERIC_FAILURE = 'הפרטים שהוזנו אינם נכונים.'

export async function login(
  email: string,
  password: string,
  meta: { ip?: string | null } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const normalised = email.trim().toLowerCase()

  // Keyed on the address AND the caller, so one attacker cannot lock a real
  // person out of their own account by burning the limit on their email alone.
  const perAccount = await consume('login', hashToken(normalised).slice(0, 32))
  const perIp = meta.ip ? await consume('login', `ip:${meta.ip}`) : { allowed: true }

  if (!perAccount.allowed || !perIp.allowed) {
    return { ok: false, message: 'יותר מדי ניסיונות כניסה. נסו שוב בעוד מספר דקות.' }
  }

  const db = getDb()
  const [user] = await db
    .select({
      id: schema.users.id,
      organizationId: schema.users.organizationId,
      passwordHash: schema.users.passwordHash,
      disabledAt: schema.users.disabledAt,
    })
    .from(schema.users)
    .where(eq(schema.users.email, normalised))
    .limit(1)

  // Always runs, so timing does not distinguish the branches.
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)

  const allowed = Boolean(user) && Boolean(user?.passwordHash) && !user?.disabledAt && passwordMatches

  if (!allowed) {
    if (user) {
      await recordAdminAction({
        organizationId: user.organizationId,
        type: AUDIT_EVENTS.LOGIN_FAILED,
        actorEmail: normalised,
        ip: meta.ip,
        // Recorded internally so an admin can tell a locked-out colleague from
        // a password-guessing run. Never surfaced to the person logging in.
        metadata: { reason: user.disabledAt ? 'disabled' : !user.passwordHash ? 'not_accepted' : 'bad_password' },
      })
    }
    return { ok: false, message: GENERIC_FAILURE }
  }

  await createSession(user!.id)

  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user!.id))

  await recordAdminAction({
    organizationId: user!.organizationId,
    type: AUDIT_EVENTS.LOGIN_SUCCEEDED,
    actorEmail: normalised,
    ip: meta.ip,
  })

  return { ok: true }
}
