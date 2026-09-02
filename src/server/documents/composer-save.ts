import type { StaffSession } from '@/server/auth/session'
import { renderComposedDocument } from '@/server/documents/composer-render'
import { processDocumentVersion } from '@/server/documents/process-document'
import { saveFields } from '@/server/documents/save-fields'
import { uploadDocument } from '@/server/documents/upload-document'
import { log } from '@/server/log'

/** Longer than any agreement anyone will write by hand or by assistant. */
export const MAX_COMPOSED_HTML = 400_000

export type ComposedSaveResult =
  | { ok: true; agreementId: string; fields: number; warning?: string }
  | { ok: false; message: string }

/**
 * Turning authored HTML into a filed draft with its fields placed.
 *
 * Extracted from the composer's route so the editor and the assistant travel
 * exactly the same path: same rendering, same validation, same audit. A second
 * implementation for the assistant would be a second set of bugs, and a second
 * place for a field to end up somewhere it was not put.
 */
export async function saveComposedDocument(input: {
  session: StaffSession
  title: string
  html: string
  companyId: string
  ip?: string | null
  userAgent?: string | null
}): Promise<ComposedSaveResult> {
  const title = input.title.trim().slice(0, 200)
  if (!title) return { ok: false, message: 'יש להזין שם למסמך.' }
  if (!input.companyId) return { ok: false, message: 'יש לבחור ספק או לקוח.' }
  if (!input.html.trim()) return { ok: false, message: 'יש להזין את תוכן המסמך.' }
  if (input.html.length > MAX_COMPOSED_HTML) return { ok: false, message: 'המסמך ארוך מדי.' }

  let rendered
  try {
    rendered = await renderComposedDocument(input.html)
  } catch (error) {
    log.error('composer render failed', { error: String(error) })
    return { ok: false, message: 'ההמרה ל-PDF נכשלה.' }
  }

  const uploaded = await uploadDocument({
    session: input.session,
    buffer: rendered.pdf,
    filename: `${title}.pdf`,
    companyId: input.companyId,
    sourceKind: 'composed',
    origin: { composed: true },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
  if (!uploaded.ok) return { ok: false, message: uploaded.message }

  const processed = await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: input.session.organizationId,
    versionId: uploaded.versionId,
    actor: input.session.email,
  })
  if (!processed.ok) return { ok: false, message: processed.message }

  if (rendered.fields.length > 0) {
    const saved = await saveFields({
      session: input.session,
      agreementId: uploaded.agreementId,
      fields: rendered.fields,
    })
    // The document exists; say plainly that the fields did not make it rather
    // than leaving a half-made draft to be discovered later.
    if (!saved.ok) {
      return {
        ok: true,
        agreementId: uploaded.agreementId,
        fields: 0,
        warning: `המסמך נוצר, אך השדות לא נשמרו: ${saved.message}`,
      }
    }
  }

  return { ok: true, agreementId: uploaded.agreementId, fields: rendered.fields.length }
}
