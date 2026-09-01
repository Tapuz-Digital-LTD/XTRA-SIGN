import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentRow } from '@/components/DocumentRow'
import { EmptyState } from '@/components/EmptyState'
import { ListFilters } from '@/components/ListFilters'
import { getSession } from '@/server/auth/session'
import { countDocuments, listDocuments, type ListFilter } from '@/server/documents/queries'

const FILTERS: ListFilter[] = ['all', 'pending', 'signed', 'drafts']

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const filter = (FILTERS as string[]).includes(params.filter ?? '')
    ? (params.filter as ListFilter)
    : 'all'
  const search = params.q ?? ''

  const [documents, counts] = await Promise.all([
    listDocuments(session, { filter, search }),
    countDocuments(session),
  ])

  const searching = Boolean(search.trim()) || filter !== 'all'

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">מסמכים</h1>

      {/* A small overview, not a dashboard. Three numbers someone acts on. */}
      <dl className="mt-5 grid grid-cols-3 gap-3">
        {[
          // "ממתינים" not "ממתינים לחתימה": the longer label wraps at 375px and
          // pushes its number out of line with the other two cards. It also
          // matches the filter tab beside it.
          { label: 'ממתינים', value: counts.pending },
          { label: 'נחתמו', value: counts.signed },
          { label: 'טיוטות', value: counts.drafts },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"
          >
            <dt className="text-xs text-muted">{stat.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-fg">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <ListFilters active={filter} search={search} />
      </div>

      <div className="mt-4">
        {documents.length === 0 ? (
          searching ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
              לא נמצאו מסמכים תואמים.
            </p>
          ) : (
            <EmptyState
              title="עדיין אין כאן מסמכים"
              description="צרו מסמך ראשון ושלחו אותו לחתימה בכמה צעדים פשוטים."
              actionIcon="+"
              actionLabel="יצירת מסמך"
              actionHref="/documents/new"
            />
          )
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="block hover:bg-slate-50">
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
