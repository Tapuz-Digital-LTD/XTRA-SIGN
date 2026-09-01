import { and, eq, gt, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { generateToken, hashToken } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import { OPEN_STATUSES } from '@/lib/status'

/**
 * The signer's side.
 *
 * Two separate things, deliberately:
 *
 *   THE SIGNING LINK is not one-time-use. A signer may close the browser, lose
 *   signal, open the link again tomorrow, and reach the same document. It stays
 *   valid until it expires, is revoked, or the agreement leaves an open status.
 *
 *   THE OTP is single-use. It proves possession of the phone once, and that
 *   proof becomes a session so a refresh does not re-challenge someone standing
 *   in a car park with one bar of signal.
 */

/** Same `__Host-` reasoning as the staff session cookie. */
export const SIGNING_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-xtra_sign_signer' : 'xtra_sign_signer'
const SESSION_TTL_MS = 60 * 60 * 1000

export type SigningContext = {
  recipientId: string
  agreementId: string
  organizationId: string
  tokenId: string
  title: string
  recipientName: string
  recipientPhone: string | null
  recipientEmail: string | null
  versionId: string
  status: (typeof schema.agreementStatus.enumValues)[number]
}

/**
 * Resolves a raw signing token to the document it opens, or null.
 *
 * Null for expired, revoked, unknown, and for an agreement that is no longer
 * open — all the same answer, because distinguishing them tells an enumerator
 * which tokens exist.
 */
export async function resolveSigningToken(token: string): Promise<SigningContext | null> {
  if (!token || token.length < 20 || token.length > 200) return null

  const db = getDb()
  const rows = await db
    .select({
      tokenId: schema.signingTokens.id,
      recipientId: schema.recipients.id,
      recipientName: schema.recipients.name,
      recipientPhone: schema.recipients.phone,
      recipientEmail: schema.recipients.email,
      agreementId: schema.agreements.id,
      organizationId: schema.agreements.organizationId,
      title: schema.agreements.title,
      status: schema.agreements.status,
      versionId: schema.agreements.currentVersionId,
    })
    .from(schema.signingTokens)
    .innerJoin(schema.recipients, eq(schema.recipients.id, schema.signingTokens.recipientId))
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.recipients.agreementId))
    .where(
      and(
        eq(schema.signingTokens.tokenHash, hashToken(token)),
        gt(schema.signingTokens.expiresAt, new Date()),
        isNull(schema.signingTokens.revokedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row?.versionId) return null

  // A completed, declined or cancelled agreement is not signable any more, but
  // the link still resolves for the "already signed" screen.
  return {
    tokenId: row.tokenId,
    recipientId: row.recipientId,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    recipientEmail: row.recipientEmail,
    agreementId: row.agreementId,
    organizationId: row.organizationId,
    title: row.title,
    status: row.status,
    versionId: row.versionId,
  }
}

export function isSignable(status: SigningContext['status']): boolean {
  return OPEN_STATUSES.includes(status)
}

/**
 * Issues the post-OTP session.
 *
 * Bound to both the recipient and the token that was actually opened, so a
 * session cannot be replayed against a different document, and scoped to /sign
 * so it is never sent to the admin side.
 */
export async function createSigningSession(input: {
  recipientId: string
  tokenId: string
}): Promise<void> {
  const db = getDb()
  const secret = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(schema.signingSessions).values({
    recipientId: input.recipientId,
    signingTokenId: input.tokenId,
    sessionHash: hashToken(secret),
    expiresAt,
  })

  const store = await cookies()
  store.set(SIGNING_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

/**
 * True when this browser has already proved possession for this token.
 *
 * This is what makes a refresh or a reopened tab skip the OTP: the proof lives
 * server-side and the cookie is just an opaque handle to it.
 */
export async function hasVerifiedSession(context: SigningContext): Promise<boolean> {
  const store = await cookies()
  const secret = store.get(SIGNING_COOKIE)?.value
  if (!secret) return false

  const db = getDb()
  const rows = await db
    .select({ id: schema.signingSessions.id })
    .from(schema.signingSessions)
    .where(
      and(
        eq(schema.signingSessions.sessionHash, hashToken(secret)),
        eq(schema.signingSessions.recipientId, context.recipientId),
        eq(schema.signingSessions.signingTokenId, context.tokenId),
        gt(schema.signingSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return rows.length > 0
}
