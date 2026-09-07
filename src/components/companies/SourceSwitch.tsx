import Link from 'next/link'
import type { CompanySource } from '@/server/companies/companies'

/** A screen's source: one side, or — on the reports only — both, spelled out. */
export type SourceView = CompanySource | 'all'

/** `?source=` on a reports screen. 'all' must be asked for by name; a bare address is XTRA Sign. */
export function parseSourceView(value: unknown): SourceView {
  return value === 'crm' || value === 'all' ? value : 'xtra'
}

/** A path with `source` (XTRA Sign is the default and carries no parameter) and whatever else the screen keeps. */
export function withSource(path: string, source: SourceView, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  if (source !== 'xtra') query.set('source', source)
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * XTRA Sign | CRM — which records a suppliers/customers screen is about.
 *
 * Links, not buttons: the choice lives in the URL, so search, chips, tabs and
 * a reload all keep it, and a link someone pastes opens on the same side.
 */
export function SourceSwitch({
  base,
  source,
  params = {},
  allowAll = false,
}: {
  base: string
  source: SourceView
  /** Query params to keep when switching (the search term, a group). */
  params?: Record<string, string | undefined>
  /** Offers "כל המקורות" as well — for a report that then breaks down by source. */
  allowAll?: boolean
}) {
  const options: { key: SourceView; label: string }[] = [
    { key: 'xtra', label: 'XTRA Sign' },
    { key: 'crm', label: 'CRM' },
    ...(allowAll ? [{ key: 'all' as const, label: 'כל המקורות' }] : []),
  ]
  return (
    <nav
      aria-label="מקור הרשומות"
      className={`grid w-full gap-1 rounded-lg bg-bg p-1 sm:inline-grid sm:w-auto ${allowAll ? 'grid-cols-3' : 'grid-cols-2'}`}
    >
      {options.map((option) => (
        <Link
          key={option.key}
          href={withSource(base, option.key, params)}
          aria-current={source === option.key ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm transition ${
            source === option.key ? 'bg-surface font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}
