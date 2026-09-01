import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { sha256 } from './file-validation'
import { ProcessingError } from './limits'
import { readPdfGeometry } from './pdf-geometry'

/**
 * Prepares an uploaded document for the field editor.
 *
 * In version 1 that means reading each page's real size and recording the hash —
 * nothing is rendered. The PDF is already its own fixed-layout render, and the
 * browser draws it with pdf.js when someone looks at it, so there is no
 * conversion step, no page images, and no container to run either in.
 */

export type ProcessResult = { ok: true; pageCount: number } | { ok: false; message: string }

export async function processDocumentVersion(input: {
  agreementId: string
  organizationId: string
  versionId: string
  actor: string
}): Promise<ProcessResult> {
  const db = getDb()

  const [version] = await db
    .select()
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, input.versionId))
    .limit(1)

  if (!version?.sourceFileKey) return { ok: false, message: 'המסמך לא נמצא.' }

  try {
    const bytes = await getStorage().get(version.sourceFileKey)
    const { pageCount, pages } = await readPdfGeometry(bytes)

    // The uploaded PDF IS the rendered document — there is nothing to convert,
    // so one object serves both roles and carries one hash.
    const hash = sha256(bytes)

    await db.transaction(async (tx) => {
      // Replace rather than append: reprocessing must not leave two geometries
      // for the same page.
      await tx
        .delete(schema.documentPages)
        .where(eq(schema.documentPages.agreementVersionId, input.versionId))

      await tx.insert(schema.documentPages).values(
        pages.map((page) => ({
          agreementVersionId: input.versionId,
          pageNumber: page.page,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
        })),
      )

      await tx
        .update(schema.agreementVersions)
        .set({
          renderedFileKey: version.sourceFileKey,
          renderedHash: hash,
          pageCount,
        })
        .where(eq(schema.agreementVersions.id, input.versionId))

      await tx.insert(schema.auditEvents).values({
        agreementId: input.agreementId,
        type: AUDIT_EVENTS.DOCUMENT_GENERATED,
        actor: input.actor,
        metadata: { kind: 'pdf', pageCount, renderedHash: hash },
      })
    })

    return { ok: true, pageCount }
  } catch (error) {
    // A refused document is an expected outcome for a broken or hostile file,
    // not an exception to propagate. The Hebrew message names the actual problem
    // so the user knows what to do differently.
    const message =
      error instanceof ProcessingError
        ? error.userMessage
        : 'לא הצלחנו לקרוא את המסמך. ייתכן שהקובץ פגום.'

    await db.insert(schema.auditEvents).values({
      agreementId: input.agreementId,
      type: 'document_generation_failed',
      actor: input.actor,
      metadata: { failure: error instanceof ProcessingError ? error.failure : 'unknown' },
    })

    return { ok: false, message }
  }
}
