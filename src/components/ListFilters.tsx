import Link from 'next/link'
import type { ListFilter } from '@/server/documents/queries'

const TABS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'pending', label: 'ממתינים' },
  { key: 'signed', label: 'נחתמו' },
  { key: 'drafts', label: 'טיוטות' },
]

/**
 * Filters as links and search as a GET form: the state lives in the URL, so a
 * filtered view can be shared, bookmarked, and survives the back button.
 */
export function ListFilters({ active, search }: { active: ListFilter; search: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav className="flex gap-1" aria-label="סינון מסמכים">
        {TABS.map((tab) => {
          const current = tab.key === active
          return (
            <Link
              key={tab.key}
              href={tab.key === 'all' ? '/documents' : `/documents?filter=${tab.key}`}
              aria-current={current ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm transition-colors ${
                current
                  ? 'bg-slate-100 font-medium text-fg'
                  : 'text-muted hover:bg-slate-50 hover:text-fg'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <form action="/documents" className="sm:w-72">
        <label htmlFor="q" className="sr-only">
          חיפוש לפי שם מסמך, חברה או חותם
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="חיפוש לפי שם מסמך, חברה או חותם"
          className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
        />
      </form>
    </div>
  )
}
