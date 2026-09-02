import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import type { StaffSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess, authorizeVersionFileAccess } from '@/server/documents/authorization'
import { getStorage } from '@/server/storage/blob'
import { getCrmProvider } from './fireberry'

/**
 * Pushes a signed agreement's final PDF onto its company's CRM record.
 *
 * The document must be signed — the point is to file the executed copy, not a
 * draft — and it must be filed under a company that carries a CRM record id.
 * Authorization is the same tenant check every document action runs; the signed
 * file key comes from the authorized version, never from the caller.
 */
export type CrmUploadOutcome = { ok: true } | { ok: false; message: string }

export async function uploadAgreementToCrm(input: {
  session: StaffSession
  agreementId: string
}): Promise<CrmUploadOutcome> {
  const provider = getCrmProvider()
  if (!provider.isConfigured()) {
    return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }
  }

  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status !== 'signed') {
    return { ok: false, message: 'ניתן להעלות ל-CRM רק מסמך חתום.' }
  }
  if (!agreement.companyId) {
    return { ok: false, message: 'המסמך אינו משויך לספק או לקוח.' }
  }

  const company = await getCompany(input.session, agreement.companyId)
  if (!company) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }
  if (!company.crmRecordId) {
    return { ok: false, message: 'לא הוגדר מזהה רשומה ב-CRM עבור הספק/לקוח.' }
  }

  // Object type: the company's own override, else derived from its kind.
  const objectType = company.crmObjectType ?? provider.objectTypeForKind(company.kind)

  // The signed file key, resolved through the same authorization the download
  // uses, so this cannot reach another tenant's file.
  const { key, agreementTitle } = await authorizeVersionFileAccess(
    input.session,
    input.agreementId,
    'signed',
  )

  let bytes: Buffer
  try {
    bytes = await getStorage().get(key)
  } catch {
    return { ok: false, message: 'הקובץ החתום אינו זמין. נסו שוב.' }
  }

  const result = await provider.uploadFile({
    target: { objectType, recordId: company.crmRecordId },
    filename: `${agreementTitle}.pdf`,
    contentType: 'application/pdf',
    bytes,
  })

  // Audited either way: a push to a third-party system is exactly the kind of
  // action someone later asks "did this actually happen" about.
  await getDb()
    .insert(schema.auditEvents)
    .values({
      agreementId: agreement.id,
      type: AUDIT_EVENTS.CRM_UPLOADED,
      actor: input.session.email,
      metadata: {
        provider: provider.name,
        objectType,
        recordId: company.crmRecordId,
        delivered: result.ok,
        ...(result.ok ? {} : { error: result.message }),
      },
    })
    .catch(() => {})

  return result
}
