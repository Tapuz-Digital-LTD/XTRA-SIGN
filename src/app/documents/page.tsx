import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { DocumentsTable } from '@/components/documents/DocumentsTable'
import { InboxControls } from '@/components/documents/InboxControls'
import { getSession } from '@/server/auth/session'
import { listDocuments, type ListFilter } from '@/server/documents/queries'

const FILTERS: ListFilter[] = ['all', 'drafts', 'pending', 'viewed', 'signed', 'canceled', 'attention']

/**
 * The document inbox: where every document is found and worked on.
 *
 * Filtering, searching and paging all happen in the database. The organization
 * will have more documents than a page can hold long before anyone notices, and
 * a list that loads everything and filters in the browser is a screen that
 * quietly stops being usable.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const filter = (FILTERS as string[]).includes(params.filter ?? '') ? (params.filter as ListFilter) : 'all'
  const search = params.q ?? ''
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1)

  const [result, attention] = await Promise.all([
    listDocuments(session, { filter, search, page }),
    // Only the number, for the tab badge.
    listDocuments(session, { filter: 'attention', pageSize: 1 }),
  ])

  const { items, total, pageSize, now } = result
  const pages = Math.max(Math.ceil(total / pageSize), 1)
  const filtering = Boolean(search.trim()) || filter !== 'all'

  const href = (next: number) => {
    const query = new URLSearchParams()
    if (filter !== 'all') query.set('filter', filter)
    if (search.trim()) query.set('q', search.trim())
    if (next > 1) query.set('page', String(next))
    return `/documents${query.toString() ? `?${query}` : ''}`
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-fg">מסמכים</h1>
        <Link
          href="/documents/new"
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
        >
          + מסמך חדש
        </Link>
      </div>

      <div className="mt-5">
        <InboxControls key={search} filter={filter} search={search} attentionCount={attention.total} />
      </div>

      <div className="mt-4">
        {items.length === 0 ? (
          filtering ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-fg">לא נמצאו מסמכים מתאימים</p>
              <p className="mt-1 text-sm text-muted">נסו מונח אחר, או הסירו את הסינון.</p>
              <Link href="/documents" className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand">
                ניקוי הסינון
              </Link>
            </div>
          ) : (
            <EmptyState
              title="עדיין אין מסמכים"
              description="כל מסמך שנשלח לחתימה יופיע כאן — עם החברה שאליה הוא שייך, מי החותם ומה הסטטוס."
              actionIcon="+"
              actionLabel="יצירת מסמך ראשון"
              actionHref="/documents/new"
            />
          )
        ) : (
          <>
            <DocumentsTable documents={items} now={now} />

            {pages > 1 ? (
              <nav className="mt-4 flex items-center justify-between gap-3" aria-label="עמודים">
                <p className="text-xs text-muted">
                  {(result.page - 1) * pageSize + 1}–{Math.min(result.page * pageSize, total)} מתוך {total}
                </p>
                <div className="flex gap-2">
                  {result.page > 1 ? (
                    <Link href={href(result.page - 1)} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-fg transition hover:border-brand">
                      הקודם
                    </Link>
                  ) : null}
                  {result.page < pages ? (
                    <Link href={href(result.page + 1)} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-fg transition hover:border-brand">
                      הבא
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  )
}
