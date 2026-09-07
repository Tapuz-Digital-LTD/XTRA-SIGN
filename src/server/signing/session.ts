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
/**
 * A week: the phone that received the code is the phone the signer comes back
 * on. Someone who stops halfway and returns in three days continues without a
 * second code; the session dies with the signature or the week, whichever first.
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

/**
 * The agreement behind a token whether or not the token is still valid —
 * only for handing out a fresh one. Revoked tokens stay dead.
 */
export async function resolveTokenForRenewal(token: string): Promise<{ agreementId: string; recipientId: string; status: SigningContext['status']; organizationId: string; expired: boolean } | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  const [row] = await getDb()
    .select({ recipientId: schema.recipients.id, agreementId: schema.agreements.id, status: schema.agreements.status, organizationId: schema.agreements.organizationId, expiresAt: schema.signingTokens.expiresAt })
    .from(schema.signingTokens)
    .innerJoin(schema.recipients, eq(schema.recipients.id, schema.signingTokens.recipientId))
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.recipients.agreementId))
    .where(and(eq(schema.signingTokens.tokenHash, hashToken(token)), isNull(schema.signingTokens.revokedAt)))
    .limit(1)
  if (!row) return null
  return { agreementId: row.agreementId, recipientId: row.recipientId, status: row.status, organizationId: row.organizationId, expired: row.expiresAt.getTime() <= Date.now() }
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
 * True when this browser has already proved possession for this signer.
 *
 * This is what makes a refresh, a reopened tab or a link renewed behind the
 * scenes skip the OTP: the proof lives server-side and the cookie is just an
 * opaque handle to it. Bound to the recipient, not to one token: a recipient
 * belongs to exactly one agreement, so the proof cannot be replayed against
 * another document, and a fresh token on the same agreement keeps it.
 */
export async function hasVerifiedSession(context: Pick<SigningContext, 'recipientId'>): Promise<boolean> {
  return hasVerifiedSessionFor(context.recipientId)
}

export async function hasVerifiedSessionFor(recipientId: string): Promise<boolean> {
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
        eq(schema.signingSessions.recipientId, recipientId),
        gt(schema.signingSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return rows.length > 0
}
