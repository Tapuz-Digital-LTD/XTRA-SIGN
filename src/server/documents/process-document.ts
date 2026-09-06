import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { intakeAcroForm } from './acroform'
import { buildStorageKey, sha256 } from './file-validation'
import { ProcessingError } from './limits'
import { readPdfGeometry } from './pdf-geometry'

/**
 * Prepares an uploaded document for the field editor.
 *
 * That means reading each page's real size and recording the hash — nothing is
 * rendered. The PDF is already its own fixed-layout render, and the browser
 * draws it with pdf.js when someone looks at it, so there is no conversion
 * step, no page images, and no container to run either in.
 *
 * The one transformation: a fillable PDF is flattened into the rendered copy
 * and its boxes become the document's fields (see acroform.ts). The uploaded
 * bytes stay untouched under the source key.
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
    const storage = getStorage()
    const bytes = await storage.get(version.sourceFileKey)
    const { pageCount, pages } = await readPdfGeometry(bytes)

    // A form we fail to read is not a reason to refuse the document — it is
    // then handled as the plain PDF it also is.
    const intake = await intakeAcroForm(bytes, pages).catch(() => null)

    let renderedKey = version.sourceFileKey
    let rendered = bytes
    if (intake) {
      renderedKey = buildStorageKey({
        organizationId: input.organizationId,
        agreementId: input.agreementId,
        purpose: 'rendered',
        ext: 'pdf',
      })
      // Stored before the row points at it, as everywhere else.
      await storage.put(renderedKey, intake.flattened, 'application/pdf')
      rendered = intake.flattened
    }

    const hash = sha256(rendered)

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
          renderedFileKey: renderedKey,
          renderedHash: hash,
          pageCount,
        })
        .where(eq(schema.agreementVersions.id, input.versionId))

      // The form's boxes seed the layout once. A version that already has
      // fields — a reprocess, a template's copy — keeps what it has.
      if (intake && intake.fields.length > 0) {
        const [existing] = await tx
          .select({ id: schema.fields.id })
          .from(schema.fields)
          .where(eq(schema.fields.agreementVersionId, input.versionId))
          .limit(1)
        if (!existing) {
          await tx.insert(schema.fields).values(
            intake.fields.map((field) => ({
              agreementVersionId: input.versionId,
              type: field.type,
              label: field.label,
              variableKey: field.variableKey ?? null,
              ownedBy: field.ownedBy,
              required: field.required,
              page: field.page,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              options: field.options,
              placeholder: field.placeholder,
              autoFill: field.autoFill,
              autoSource: field.autoSource,
              value: null,
            })),
          )
        }
      }

      await tx.insert(schema.auditEvents).values({
        agreementId: input.agreementId,
        type: AUDIT_EVENTS.DOCUMENT_GENERATED,
        actor: input.actor,
        metadata: {
          kind: 'pdf',
          pageCount,
          renderedHash: hash,
          ...(intake ? { formFields: intake.fields.length, flattened: true } : {}),
        },
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
