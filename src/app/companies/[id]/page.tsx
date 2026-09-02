import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyHeader } from '@/components/companies/CompanyHeader'
import { CrmDocumentImport } from '@/components/companies/CrmDocumentImport'
import { CrmBusinessImport } from '@/components/crm/CrmBusinessImport'
import { DocumentsTable } from '@/components/documents/DocumentsTable'
import { getSession } from '@/server/auth/session'
import { crmObjectTypeFor, getCompany } from '@/server/companies/companies'
import { listBusinessDocuments } from '@/server/crm/business-documents'
import { countDocuments, listDocuments, type ListFilter } from '@/server/documents/queries'
import { groupsForCompany } from '@/server/groups/groups'

const DOC_FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'drafts', label: 'טיוטות' },
  { key: 'pending', label: 'ממתינים' },
  { key: 'signed', label: 'נחתמו' },
]

type Tab = 'details' | 'documents' | 'crm'

/**
 * A company as a place to work from, not just a record to look at.
 *
 * Three tabs, because the three questions are different: who they are, what has
 * been signed with them, and what the CRM holds. "מסמך חדש" starts from here
 * with the company already chosen, so the wizard's first step is skipped.
 */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ filter?: string; tab?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const company = await getCompany(session, id)
  if (!company) notFound()

  const noun = company.kind === 'supplier' ? 'ספק' : 'לקוח'
  const query = await searchParams
  const tab: Tab = query.tab === 'details' || query.tab === 'crm' ? query.tab : 'documents'
  const filter = (DOC_FILTERS.map((f) => f.key) as string[]).includes(query.filter ?? '')
    ? (query.filter as ListFilter)
    : 'all'

  const [documents, counts, quotes, memberOf] = await Promise.all([
    listDocuments(session, { companyId: id, filter, pageSize: 100 }),
    countDocuments(session, { companyId: id }),
    // Only when that tab is open: it is a live CRM call, not a local count.
    tab === 'crm' && company.crmRecordId
      ? listBusinessDocuments({
          crmObjectType: crmObjectTypeFor(company),
          crmRecordId: company.crmRecordId,
        }).catch(() => [])
      : Promise.resolve([]),
    groupsForCompany(session, id),
  ])

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'details', label: 'פרטים' },
    { key: 'documents', label: 'מסמכים', badge: counts.pending + counts.signed + counts.drafts },
    ...(company.crmRecordId ? [{ key: 'crm' as Tab, label: 'Fireberry' }] : []),
  ]

  const tabHref = (next: Tab) => `/companies/${id}?tab=${next}`

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

      {/* The groups this company is in. Each is a link back to the filtered
          list, so a chip answers "who else is in here?" in one click. */}
      {memberOf.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">קבוצות:</span>
          {memberOf.map((group) => (
            <Link
              key={group.id}
              href={`/${company.kind === 'supplier' ? 'suppliers' : 'customers'}?group=${group.id}`}
              className="inline-flex min-h-8 items-center rounded-full bg-bg px-2.5 text-xs text-fg transition hover:bg-slate-200"
            >
              {group.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-bg p-1" aria-label="מידע על החברה">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 text-sm transition ${
                tab === t.key ? 'bg-surface font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              {t.label}
              {t.badge ? <span className="text-xs text-muted">{t.badge}</span> : null}
            </Link>
          ))}
        </nav>

        {/* The company is already known, so this skips straight to the source step. */}
        <Link
          href={`/documents/new?company=${company.id}`}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
        >
          + מסמך חדש
        </Link>
      </div>

      {tab === 'details' ? (
        <dl className="mt-4 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2">
          {[
            ['סוג', noun],
            ['ח.פ / ע.מ', company.taxId],
            ['איש קשר', company.contactName],
            ['טלפון', company.contactPhone],
            ['אימייל', company.contactEmail],
            ['כתובת', company.address],
            ['מקור', company.crmRecordId ? 'Fireberry' : 'XTRA Sign'],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-surface px-4 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm text-fg">{value || '—'}</dd>
            </div>
          ))}
          {company.notes ? (
            <div className="bg-surface px-4 py-3 sm:col-span-2">
              <dt className="text-xs text-muted">הערות</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-fg">{company.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {tab === 'documents' ? (
        <>
          <nav className="mt-4 flex flex-wrap gap-1" aria-label="סינון מסמכים">
            {DOC_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/companies/${id}?tab=documents${f.key === 'all' ? '' : `&filter=${f.key}`}`}
                aria-current={filter === f.key ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm transition ${
                  filter === f.key ? 'bg-brand text-white' : 'text-muted hover:bg-slate-100 hover:text-fg'
                }`}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          <div className="mt-4">
            {documents.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
                <p className="text-sm font-medium text-fg">
                  {filter === 'all' ? `עדיין אין מסמכים ל${company.name}` : 'אין מסמכים בסטטוס הזה'}
                </p>
                <p className="mt-1 text-sm text-muted">כל מסמך שייווצר עבור החברה הזו יופיע כאן.</p>
                <Link
                  href={`/documents/new?company=${company.id}`}
                  className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  + מסמך חדש
                </Link>
              </div>
            ) : (
              <DocumentsTable documents={documents.items} now={documents.now} />
            )}
          </div>
        </>
      ) : null}

      {tab === 'crm' && company.crmRecordId ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-fg">Fireberry</h2>
          <p className="mt-1 text-sm text-muted">
            החברה מחוברת ל-Fireberry. הסנכרון מביא עדכונים מה-CRM; הייבוא מביא קבצים שכבר מצורפים לרשומה. שום
            פעולה כאן אינה משנה דבר ב-CRM.
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">סנכרון אחרון</dt>
              <dd className="mt-0.5 text-sm text-fg">
                {company.crmSyncedAt
                  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(company.crmSyncedAt)
                  : 'טרם סונכרן'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">סוג רשומה</dt>
              <dd className="mt-0.5 text-sm text-fg">{company.crmObjectType === 1 ? 'לקוח' : 'ספק'}</dd>
            </div>
          </dl>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-4">
              {/* The record is a quote for suppliers and customers alike; which
                  print template it comes out on is machinery, and stays out of
                  the label. */}
              <h3 className="text-sm font-semibold text-fg">
                הצעות מחיר{quotes.length > 0 ? ` (${quotes.length})` : ''}
              </h3>
              <p className="mt-1 text-xs text-muted">
                הצעות המחיר של {company.name} ב-Fireberry, עם כל השורות שבהן.
              </p>
              <div className="mt-3">
                <CrmBusinessImport companyId={company.id} kind={company.kind} />
              </div>
            </div>

            <div className="rounded-lg border border-line p-4">
              <h3 className="text-sm font-semibold text-fg">קבצים מצורפים</h3>
              <p className="mt-1 text-xs text-muted">
                קובצי PDF שכבר מצורפים לרשומה עצמה ב-Fireberry.
              </p>
              <div className="mt-3">
                <CrmDocumentImport companyId={company.id} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
