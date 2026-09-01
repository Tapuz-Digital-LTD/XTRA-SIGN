import { and, eq, gt } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { getDb, schema } from '@/server/db'
import { generateToken, hashToken } from './tokens'

export const SESSION_COOKIE = 'xtra_sign_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type StaffSession = {
  userId: string
  organizationId: string
  email: string
  name: string
  isAdmin: boolean
}

/**
 * Issues a session and sets the cookie.
 *
 * The cookie value is the raw token; only its hash reaches the database. It is
 * HttpOnly so script cannot read it, SameSite=Lax so a cross-site form post
 * cannot ride it (which is what makes the mutating routes CSRF-safe), and
 * Secure outside development.
 */
export async function createSession(userId: string): Promise<void> {
  const db = getDb()
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(schema.userSessions).values({
    userId,
    sessionHash: hashToken(token),
    expiresAt,
  })

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

/**
 * The current staff session, or null.
 *
 * Expiry is enforced in the query rather than by reading a row and comparing —
 * an expired row must never be returned at all.
 */
export async function getSession(): Promise<StaffSession | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const db = getDb()
  const rows = await db
    .select({
      userId: schema.users.id,
      organizationId: schema.users.organizationId,
      email: schema.users.email,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
    })
    .from(schema.userSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
    .where(
      and(
        eq(schema.userSessions.sessionHash, hashToken(token)),
        gt(schema.userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await getDb()
      .delete(schema.userSessions)
      .where(eq(schema.userSessions.sessionHash, hashToken(token)))
  }
  store.delete(SESSION_COOKIE)
}

/** Throws rather than returning null, so a forgotten check cannot read as "no user". */
export async function requireSession(): Promise<StaffSession> {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()
  return session
}

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor() {
    super('unauthorized')
  }
}

export class ForbiddenError extends Error {
  readonly status = 403
  constructor() {
    super('forbidden')
  }
}
