import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { processDocumentVersion } from '@/server/documents/process-document'
import { uploadDocument } from '@/server/documents/upload-document'
import { FireberryProvider } from './fireberry'

/**
 * Importing a company's CRM files into XTRA Sign.
 *
 * Read-only against Fireberry: files are listed and downloaded, never changed or
 * removed there. Nothing is imported automatically — the operator picks which
 * files to bring over. Each imported document records the Fireberry file id, so
 * the same file is never imported twice.
 *
 * PDF-first: a PDF becomes a draft document that goes straight into the normal
 * signing flow. Other types are listed so the operator can see what exists, but
 * cannot be turned into a signing document.
 */

export type CrmFile = {
  id: string
  name: string
  extension: string
  sizeMb: number | null
  isPdf: boolean
  /** Already imported into XTRA Sign — shown as "כבר יובא", never imported again. */
  alreadyImported: boolean
  /** The document it was imported as, when it exists. */
  documentId: string | null
}

export type ListResult = { ok: true; files: CrmFile[] } | { ok: false; message: string }
export type ImportResult =
  | { ok: true; imported: number; skipped: number; failed: { name: string; reason: string }[] }
  | { ok: false; message: string }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > -1 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The company, confirmed to belong to the caller and linked to the CRM. */
type LinkedCompany =
  | { ok: false; message: string }
  | { ok: true; company: { id: string; crmRecordId: string; crmObjectType: number } }

async function linkedCompany(session: StaffSession, companyId: string): Promise<LinkedCompany> {
  const company = await getCompany(session, companyId)
  if (!company) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }
  if (!company.crmRecordId || company.crmObjectType == null) {
    return { ok: false, message: 'הרשומה אינה מחוברת ל-Fireberry.' }
  }
  return {
    ok: true,
    company: { id: company.id, crmRecordId: company.crmRecordId, crmObjectType: company.crmObjectType },
  }
}

export async function listCrmDocuments(input: {
  session: StaffSession
  companyId: string
}): Promise<ListResult> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

  const resolved = await linkedCompany(input.session, input.companyId)
  if (!resolved.ok) return resolved
  const { company } = resolved

  let files
  try {
    files = await provider.listRecordFiles({
      objectType: company.crmObjectType,
      recordId: company.crmRecordId,
    })
  } catch {
    return { ok: false, message: 'לא הצלחנו לקרוא את רשימת המסמכים מ-CRM.' }
  }

  // Which of these are already here, by CRM file id.
  const ids = files.map((f) => f.id)
  const existing = ids.length
    ? await getDb()
        .select({ id: schema.agreements.id, crmDocumentId: schema.agreements.crmDocumentId })
        .from(schema.agreements)
        .where(
          and(
            eq(schema.agreements.organizationId, input.session.organizationId),
            inArray(schema.agreements.crmDocumentId, ids),
          ),
        )
    : []
  const importedById = new Map(existing.filter((e) => e.crmDocumentId).map((e) => [e.crmDocumentId!, e.id]))

  return {
    ok: true,
    files: files.map((f) => {
      const extension = extensionOf(f.name)
      return {
        id: f.id,
        name: f.name,
        extension,
        sizeMb: f.sizeMb,
        isPdf: extension === 'pdf',
        alreadyImported: importedById.has(f.id),
        documentId: importedById.get(f.id) ?? null,
      }
    }),
  }
}

export async function importCrmDocuments(input: {
  session: StaffSession
  companyId: string
  fileIds: string[]
  ip?: string | null
  userAgent?: string | null
}): Promise<ImportResult> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

  const resolved = await linkedCompany(input.session, input.companyId)
  if (!resolved.ok) return resolved
  const { company } = resolved

  let files
  try {
    files = await provider.listRecordFiles({
      objectType: company.crmObjectType,
      recordId: company.crmRecordId,
    })
  } catch {
    return { ok: false, message: 'לא הצלחנו לקרוא את רשימת המסמכים מ-CRM.' }
  }

  // Only the files actually asked for, and only ones the CRM really has — the
  // client never names a URL, just an id we look up here.
  const wanted = files.filter((f) => input.fileIds.includes(f.id))
  if (wanted.length === 0) return { ok: false, message: 'לא נבחרו מסמכים לייבוא.' }

  const db = getDb()
  const alreadyThere = new Set(
    (
      await db
        .select({ crmDocumentId: schema.agreements.crmDocumentId })
        .from(schema.agreements)
        .where(
          and(
            eq(schema.agreements.organizationId, input.session.organizationId),
            isNotNull(schema.agreements.crmDocumentId),
          ),
        )
    )
      .map((r) => r.crmDocumentId!)
      .filter(Boolean),
  )

  let imported = 0
  let skipped = 0
  const failed: { name: string; reason: string }[] = []

  for (const file of wanted) {
    if (alreadyThere.has(file.id)) {
      skipped += 1
      continue
    }
    if (extensionOf(file.name) !== 'pdf') {
      failed.push({ name: file.name, reason: 'רק קובצי PDF ניתנים לייבוא' })
      continue
    }

    let bytes: Buffer
    try {
      bytes = await provider.downloadFile(file.url, MAX_FILE_BYTES)
    } catch {
      failed.push({ name: file.name, reason: 'ההורדה מ-CRM נכשלה' })
      continue
    }

    // The same path a browser upload takes: magic-byte validation, private
    // Blob storage under this organization, a draft agreement, an audit row.
    const uploaded = await uploadDocument({
      session: input.session,
      buffer: bytes,
      filename: file.name,
      companyId: company.id,
      sourceKind: 'crm_document',
      ip: input.ip,
      userAgent: input.userAgent,
    })
    if (!uploaded.ok) {
      failed.push({ name: file.name, reason: uploaded.message })
      continue
    }

    try {
      await db
        .update(schema.agreements)
        .set({ crmDocumentId: file.id })
        .where(eq(schema.agreements.id, uploaded.agreementId))
    } catch {
      // The unique index rejected it — another import got there first.
      skipped += 1
      continue
    }

    // Measure pages so the document is immediately usable in the editor.
    await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: input.session.organizationId,
      versionId: uploaded.versionId,
      actor: input.session.email,
    }).catch(() => {})

    imported += 1
  }

  return { ok: true, imported, skipped, failed }
}
