import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'

/**
 * The single door to a document.
 *
 * Every read of an agreement goes through here, and the tenant filter lives in
 * the WHERE clause rather than in an `if` after the fetch. A check that runs
 * after the row is already loaded is one early `return` away from being skipped;
 * a filter in the query cannot return a row it was never allowed to see.
 *
 * A client-supplied agreement id is treated as a claim to be verified, never as
 * proof of anything.
 */

export type AuthorizedAgreement = {
  id: string
  organizationId: string
  title: string
  status: (typeof schema.agreementStatus.enumValues)[number]
  ownerId: string
  companyId: string | null
  currentVersionId: string | null
  /** The canvas design, when the document was made in the design editor. */
  canvasDocument: unknown
}

/**
 * Loads an agreement the session is allowed to see, or throws.
 *
 * Not-found and not-yours both raise the same error. Distinguishing them turns
 * the endpoint into an oracle that confirms which ids exist.
 */
export async function authorizeAgreementAccess(
  session: StaffSession,
  agreementId: string,
): Promise<AuthorizedAgreement> {
  // A malformed id must fail here, not inside Postgres as a 500 that leaks a
  // driver error message.
  if (!isUuid(agreementId)) throw new ForbiddenError()

  const db = getDb()
  const rows = await db
    .select({
      id: schema.agreements.id,
      organizationId: schema.agreements.organizationId,
      title: schema.agreements.title,
      status: schema.agreements.status,
      ownerId: schema.agreements.ownerId,
      companyId: schema.agreements.companyId,
      currentVersionId: schema.agreements.currentVersionId,
      canvasDocument: schema.agreements.canvasDocument,
    })
    .from(schema.agreements)
    .where(
      and(
        eq(schema.agreements.id, agreementId),
        // The tenant boundary. Never omit, never make conditional.
        eq(schema.agreements.organizationId, session.organizationId),
      ),
    )
    .limit(1)

  const agreement = rows[0]
  if (!agreement) throw new ForbiddenError()

  // Within the organization: an admin sees everything, a user sees their own.
  // Widening this later is a policy change in one place.
  if (!session.isAdmin && agreement.ownerId !== session.userId) throw new ForbiddenError()

  return agreement
}

/**
 * Resolves a storage key the session may download.
 *
 * The key is looked up from the authorized agreement rather than accepted from
 * the caller. If a client could pass a key, it could pass any key.
 */
export async function authorizeVersionFileAccess(
  session: StaffSession,
  agreementId: string,
  purpose: 'source' | 'rendered' | 'signed',
): Promise<{ key: string; agreementTitle: string }> {
  const agreement = await authorizeAgreementAccess(session, agreementId)

  const db = getDb()
  const rows = await db
    .select({
      sourceFileKey: schema.agreementVersions.sourceFileKey,
      renderedFileKey: schema.agreementVersions.renderedFileKey,
      signedFileKey: schema.agreementVersions.signedFileKey,
    })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.agreementId, agreement.id))
    .orderBy(schema.agreementVersions.versionNumber)

  const version = rows.at(-1)
  if (!version) throw new ForbiddenError()

  const key =
    purpose === 'source'
      ? version.sourceFileKey
      : purpose === 'rendered'
        ? version.renderedFileKey
        : version.signedFileKey

  if (!key) throw new ForbiddenError()

  // A key must live under this organization's prefix. Belt and braces: if a row
  // is ever wrong, the tenant boundary still holds.
  if (!key.startsWith(`org/${agreement.organizationId}/`)) throw new ForbiddenError()

  return { key, agreementTitle: agreement.title }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}
