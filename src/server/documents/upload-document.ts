import { eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/s3'
import {
  buildStorageKey,
  sanitizeDisplayName,
  validateUpload,
  type ValidationError,
} from './file-validation'

/**
 * Upload a document and open a draft agreement around it.
 *
 * A use-case, not a route handler: the same function will back the CRM-facing
 * API later without the HTTP layer being rewritten.
 */

export type UploadDocumentInput = {
  session: StaffSession
  buffer: Buffer
  filename: string
  ip?: string | null
  userAgent?: string | null
}

export type UploadDocumentResult =
  | {
      ok: true
      agreementId: string
      versionId: string
      kind: 'pdf' | 'docx' | 'doc'
      sha256: string
      /** DOC/DOCX still need conversion before fields can be placed. */
      needsConversion: boolean
    }
  | ValidationError

export async function uploadDocument(input: UploadDocumentInput): Promise<UploadDocumentResult> {
  const { session, buffer, filename } = input

  // Validate before anything is stored or written. Bytes that fail here never
  // reach the object store.
  const validation = validateUpload(buffer)
  if (!validation.ok) return validation

  const db = getDb()
  const storage = getStorage()
  const title = sanitizeDisplayName(filename)

  const agreementId = crypto.randomUUID()
  const key = buildStorageKey({
    organizationId: session.organizationId,
    agreementId,
    purpose: 'source',
    ext: validation.ext,
  })

  // Store first. An orphaned object costs storage; a row pointing at a missing
  // object breaks every later read.
  await storage.put(key, buffer, validation.mime)

  const versionId = await db.transaction(async (tx) => {
    await tx.insert(schema.agreements).values({
      id: agreementId,
      organizationId: session.organizationId,
      title,
      status: 'draft',
      ownerId: session.userId,
    })

    const [version] = await tx
      .insert(schema.agreementVersions)
      .values({
        agreementId,
        versionNumber: 1,
        sourceFileKey: key,
        // A PDF is already its own fixed-layout render. DOC/DOCX get a
        // renderedFileKey once conversion runs.
        renderedFileKey: validation.kind === 'pdf' ? key : null,
        renderedHash: validation.kind === 'pdf' ? validation.sha256 : null,
      })
      .returning({ id: schema.agreementVersions.id })

    await tx
      .update(schema.agreements)
      .set({ currentVersionId: version.id })
      .where(eq(schema.agreements.id, agreementId))

    await tx.insert(schema.auditEvents).values([
      {
        agreementId,
        type: AUDIT_EVENTS.CREATED,
        actor: session.email,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        // Narrow on purpose: enough to reconstruct what was uploaded, nothing
        // that would leak content or secrets into the log.
        metadata: {
          kind: validation.kind,
          size: validation.size,
          sha256: validation.sha256,
        },
      },
    ])

    return version.id
  })

  return {
    ok: true,
    agreementId,
    versionId,
    kind: validation.kind,
    sha256: validation.sha256,
    needsConversion: validation.kind !== 'pdf',
  }
}
