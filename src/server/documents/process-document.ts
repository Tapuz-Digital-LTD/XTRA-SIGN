import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/s3'
import { convertDocument } from './converter'
import { buildStorageKey, sha256 } from './file-validation'
import { ProcessingError } from './limits'

/**
 * Turns an uploaded version into something the field editor can work on: a
 * fixed-layout PDF plus one image per page.
 *
 * Runs after upload rather than inside it. A conversion takes seconds and must
 * not hold the upload request open, and a conversion failure must leave the
 * uploaded original intact — the user can still download what they gave us.
 */

export type ProcessResult =
  | { ok: true; pageCount: number }
  | { ok: false; message: string }

export async function processDocumentVersion(input: {
  agreementId: string
  organizationId: string
  versionId: string
  actor: string
}): Promise<ProcessResult> {
  const db = getDb()
  const storage = getStorage()

  const [version] = await db
    .select()
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, input.versionId))
    .limit(1)

  if (!version?.sourceFileKey) return { ok: false, message: 'המסמך לא נמצא.' }

  const kind = version.sourceFileKey.endsWith('.pdf')
    ? 'pdf'
    : version.sourceFileKey.endsWith('.docx')
      ? 'docx'
      : 'doc'

  try {
    const source = await storage.get(version.sourceFileKey)
    const { pdf, pages, pageCount } = await convertDocument({ buffer: source, kind })

    // The rendered PDF is what fields are placed against and what gets signed,
    // so it carries its own hash — the source hash says nothing about it.
    const renderedKey =
      kind === 'pdf'
        ? version.sourceFileKey
        : buildStorageKey({
            organizationId: input.organizationId,
            agreementId: input.agreementId,
            purpose: 'rendered',
            ext: 'pdf',
          })

    if (kind !== 'pdf') await storage.put(renderedKey, pdf, 'application/pdf')

    // Page images are keyed by index so the preview route can address one page
    // without listing the bucket.
    for (const [index, page] of pages.entries()) {
      await storage.put(pageImageKey(input, index + 1), page, 'image/png')
    }

    await db
      .update(schema.agreementVersions)
      .set({
        renderedFileKey: renderedKey,
        renderedHash: sha256(pdf),
        pageCount,
      })
      .where(eq(schema.agreementVersions.id, input.versionId))

    await db.insert(schema.auditEvents).values({
      agreementId: input.agreementId,
      type: AUDIT_EVENTS.DOCUMENT_GENERATED,
      actor: input.actor,
      metadata: { kind, pageCount, renderedHash: sha256(pdf) },
    })

    return { ok: true, pageCount }
  } catch (error) {
    // A conversion failure is an expected outcome for a hostile or broken file,
    // not an exception to propagate. The Hebrew message names the actual
    // problem so the user knows what to do differently.
    const message =
      error instanceof ProcessingError
        ? error.userMessage
        : 'לא הצלחנו להכין את המסמך. נסו לשמור אותו כ-PDF ולהעלות שוב.'

    await db.insert(schema.auditEvents).values({
      agreementId: input.agreementId,
      type: 'document_generation_failed',
      actor: input.actor,
      metadata: {
        failure: error instanceof ProcessingError ? error.failure : 'unknown',
      },
    })

    return { ok: false, message }
  }
}

/** Deterministic, so a page can be addressed without a bucket listing. */
export function pageImageKey(
  input: { organizationId: string; agreementId: string; versionId: string },
  page: number,
): string {
  return `org/${input.organizationId}/agreements/${input.agreementId}/pages/${input.versionId}/${page}.png`
}
