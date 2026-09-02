import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import type { StaffSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { processDocumentVersion } from '@/server/documents/process-document'
import { uploadDocument } from '@/server/documents/upload-document'
import { log } from '@/server/log'
import { renderBusinessDocument } from './business-documents'
import { sanitizeTemplateHtml } from './html-sanitize'
import { inlineAssets } from './inline-assets'
import { renderHtmlToPdf } from './html-to-pdf'

/**
 * Turning a Fireberry quote or order into a document to be signed.
 *
 * The PDF is rendered once, here, from the record as it stands, and the values
 * that went into it are stored beside the agreement. Fireberry is the source of
 * those values at this moment and never again: editing the quote next week does
 * not alter a document somebody already signed.
 *
 * The source record is recorded too, so in six months "what was this signature
 * on" has an exact answer — quote 1758, not merely "something for that customer".
 */

export type ImportResult =
  | { ok: true; agreementId: string; itemCount: number }
  | { ok: false; message: string }

export async function importBusinessDocument(input: {
  session: StaffSession
  companyId: string
  crmObjectType: number
  crmRecordId: string
  ip?: string | null
  userAgent?: string | null
}): Promise<ImportResult> {
  const company = await getCompany(input.session, input.companyId)
  if (!company) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }

  let rendered
  try {
    rendered = await renderBusinessDocument({
      objectType: input.crmObjectType,
      recordId: input.crmRecordId,
    })
  } catch (error) {
    log.error('business document render failed', { recordId: input.crmRecordId, error: String(error) })
    return { ok: false, message: 'לא הצלחנו להביא את המסמך מ-Fireberry.' }
  }

  // A raw token must never reach a signer. If one survived, that is a bug in
  // resolution and the document is not fit to send.
  if (/\{\[!/.test(rendered.html)) {
    return { ok: false, message: 'נותרו שדות שלא נפתרו במסמך. פנו לתמיכה.' }
  }

  let pdf: Buffer
  try {
    const { html, images } = sanitizeTemplateHtml(rendered.html)
    const inlined = await inlineAssets(html, images)
    pdf = await renderHtmlToPdf(inlined.html)
  } catch (error) {
    log.error('business document pdf failed', { recordId: input.crmRecordId, error: String(error) })
    return { ok: false, message: 'ההמרה ל-PDF נכשלה.' }
  }

  const uploaded = await uploadDocument({
    session: input.session,
    buffer: pdf,
    filename: `${rendered.title || 'מסמך'}.pdf`,
    companyId: company.id,
    sourceKind: 'crm_document',
    ip: input.ip,
    userAgent: input.userAgent,
  })
  if (!uploaded.ok) return { ok: false, message: uploaded.message }

  const db = getDb()
  await db
    .update(schema.agreements)
    .set({
      crmObjectType: input.crmObjectType,
      crmRecordId: input.crmRecordId,
      mergeSnapshot: { values: rendered.values, itemCount: rendered.itemCount, capturedAt: new Date().toISOString() },
    })
    .where(eq(schema.agreements.id, uploaded.agreementId))

  await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: input.session.organizationId,
    versionId: uploaded.versionId,
    actor: input.session.email,
  }).catch(() => {})

  // Page count is measured by the processing step; this is only a sanity check
  // that what was stored is a readable PDF.
  try {
    await PDFDocument.load(pdf, { updateMetadata: false })
  } catch {
    return { ok: false, message: 'ה-PDF שנוצר אינו קריא.' }
  }

  return { ok: true, agreementId: uploaded.agreementId, itemCount: rendered.itemCount }
}
