import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyHeader } from '@/components/companies/CompanyHeader'
import { CrmDocumentImport } from '@/components/companies/CrmDocumentImport'
import { DocumentRow } from '@/components/DocumentRow'
import { getSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'

import { countDocuments, listDocuments, type ListFilter } from '@/server/documents/queries'

const FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'pending', label: 'ממתינים' },
  { key: 'signed', label: 'נחתמו' },
  { key: 'drafts', label: 'טיוטות' },
]

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ filter?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const company = await getCompany(session, id)
  if (!company) notFound()

  const noun = company.kind === 'supplier' ? 'ספק' : 'לקוח'
  const { filter: filterParam } = await searchParams
  const filter = (FILTERS.map((f) => f.key) as string[]).includes(filterParam ?? '')
    ? (filterParam as ListFilter)
    : 'all'

  const [documents, counts] = await Promise.all([
    listDocuments(session, { companyId: id, filter }),
    countDocuments(session, { companyId: id }),
  ])

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href={company.kind === 'supplier' ? '/suppliers' : '/customers'}
          className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          {company.kind === 'supplier' ? '→ לכל הספקים' : '→ לכל הלקוחות'}
        </Link>
      </div>

      <CompanyHeader company={company} noun={noun} crmAppUrl={process.env.FIREBERRY_APP_URL ?? null} />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">מסמכים</h2>
        <div className="flex flex-wrap items-center gap-2">
        {company.crmRecordId ? <CrmDocumentImport companyId={company.id} /> : null}
        <Link
          href={`/documents/new?company=${company.id}`}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">
            +
          </span>
          מסמך חדש
        </Link>
        </div>
      </div>

      {/* Filters, only once there is something to filter. */}
      {counts.pending + counts.signed + counts.drafts > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-1" aria-label="סינון מסמכים">
          {FILTERS.map((f) => {
            const active = f.key === filter
            return (
              <Link
                key={f.key}
                href={f.key === 'all' ? `/companies/${company.id}` : `/companies/${company.id}?filter=${f.key}`}
                className={`inline-flex min-h-9 items-center rounded-lg px-3 text-sm transition-colors ${
                  active ? 'bg-brand text-white' : 'text-muted hover:bg-slate-100 hover:text-fg'
                }`}
              >
                {f.label}
              </Link>
            )
          })}
        </nav>
      ) : null}

      <div className="mt-4">
        {documents.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
            <p className="text-sm font-medium text-fg">
              {filter === 'all' ? `עדיין אין מסמכים ל${company.name}` : 'אין מסמכים בסטטוס הזה'}
            </p>
            {filter === 'all' ? (
              <p className="mt-1 text-sm text-muted">צרו מסמך ראשון ושלחו אותו לחתימה.</p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="block transition-colors hover:bg-bg">
                  <DocumentRow document={doc} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
