import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { createSession } from './session'
import { verifyPassword } from './tokens'

/**
 * Verifies credentials and opens a session.
 *
 * Returns one opaque failure for a missing user and a wrong password alike:
 * distinguishing them turns the form into an account-enumeration oracle. The
 * dummy verify on the missing-user path keeps the timing similar too.
 */
const DUMMY_HASH =
  'scrypt$00000000000000000000000000000000$' + '0'.repeat(128)

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getDb()
  const [user] = await db
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1)

  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)

  if (!user || !valid) {
    return { ok: false, message: 'הפרטים שהוזנו אינם נכונים.' }
  }

  await createSession(user.id)
  return { ok: true }
}
