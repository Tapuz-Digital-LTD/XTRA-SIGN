import { eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import {
  buildStorageKey,
  sanitizeDisplayName,
  validateUpload,
  type ValidationError,
} from './file-validation'

/**
 * Takes a document and opens a draft agreement around it.
 *
 * Two entry points over the same body: `uploadDocument` receives the bytes
 * directly (tests, and a future CRM-facing API), while
 * `adoptUploadedDocument` picks up a file the browser already PUT straight to
 * Blob. Both validate the same way, because the validation is the point.
 */

export type UploadDocumentInput = {
  session: StaffSession
  buffer: Buffer
  filename: string
  /** When the bytes are already in storage, adopt that object instead of writing a new one. */
  existingKey?: string
  /** Where the document came from, when not a plain upload. Recorded, never trusted for anything. */
  origin?: { templateId: string } | { composed: true }
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

  let key: string
  if (input.existingKey) {
    // Already in storage — the browser PUT it there. Nothing to write.
    key = input.existingKey
  } else {
    key = buildStorageKey({
      organizationId: session.organizationId,
      agreementId,
      purpose: 'source',
      ext: validation.ext,
    })
    // Store first. An orphaned object costs storage; a row pointing at a
    // missing object breaks every later read.
    await storage.put(key, buffer, validation.mime)
  }

  const versionId = await db.transaction(async (tx) => {
    await tx.insert(schema.agreements).values({
      id: agreementId,
      organizationId: session.organizationId,
      templateId: input.origin && 'templateId' in input.origin ? input.origin.templateId : null,
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
          ...(input.origin ?? {}),
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


/**
 * Adopts a file the browser uploaded straight to Blob.
 *
 * The bytes are fetched back and validated here, because nothing the browser
 * declared about them can be trusted: the presigned URL enforced a size and a
 * Content-Type, and the Content-Type is a string the uploader chose. A file
 * whose leading bytes are not a PDF is DELETED rather than left sitting in the
 * store — an unreferenced object that failed validation is exactly the thing
 * that should not persist.
 */
export async function adoptUploadedDocument(input: {
  session: StaffSession
  key: string
  filename: string
  ip?: string | null
  userAgent?: string | null
}): Promise<
  { ok: true; agreementId: string; pageCount: number } | { ok: false; message: string }
> {
  const storage = getStorage()

  let bytes: Buffer
  try {
    bytes = await storage.get(input.key)
  } catch {
    return { ok: false, message: 'ההעלאה לא הושלמה. נסו שוב.' }
  }

  const uploaded = await uploadDocument({
    session: input.session,
    buffer: bytes,
    filename: input.filename,
    existingKey: input.key,
    ip: input.ip,
    userAgent: input.userAgent,
  })

  if (!uploaded.ok) {
    await storage.delete(input.key).catch(() => {})
    return { ok: false, message: uploaded.message }
  }

  const { processDocumentVersion } = await import('./process-document')
  const processed = await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: input.session.organizationId,
    versionId: uploaded.versionId,
    actor: input.session.email,
  })

  if (!processed.ok) {
    // The agreement and the original file are kept: the user can still download
    // what they uploaded, and replace it.
    return { ok: false, message: processed.message }
  }

  return { ok: true, agreementId: uploaded.agreementId, pageCount: processed.pageCount }
}
