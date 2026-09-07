import type { CompanySource } from '@/server/companies/companies'

/**
 * The one place that says which side a company is on.
 *
 * CRM is every record with a Fireberry id, whether the sync brought it or it
 * was created here and linked; XTRA Sign is everything else. A linked one
 * keeps `source = 'xtra'`, and that is the note — its origin is never rewritten.
 */
export function sourceOf(company: { crmRecordId: string | null }): CompanySource {
  return company.crmRecordId ? 'crm' : 'xtra'
}

export const SOURCE_LABELS: Record<CompanySource, string> = { crm: 'CRM', xtra: 'XTRA Sign' }

export const LINKED_NOTE = 'נוצר ב-XTRA Sign וקושר ל-CRM'

/** Created here, linked to the CRM afterwards. */
export function isLinked(company: { crmRecordId: string | null; source: string }): boolean {
  return Boolean(company.crmRecordId) && company.source !== 'crm'
}

export function SourceBadge({ company }: { company: { crmRecordId: string | null } }) {
  const source = sourceOf(company)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        source === 'crm' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {SOURCE_LABELS[source]}
    </span>
  )
}
