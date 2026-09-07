import Link from 'next/link'
import type { CompanySource } from '@/server/companies/companies'

/** A screen's source: one side, or — on the reports only — both, spelled out. */
export type SourceView = CompanySource | 'all'

/** `?source=` on a reports screen. null when nothing was chosen; 'all' must be asked for by name. */
export function parseSourceView(value: unknown): SourceView | null {
  return value === 'crm' || value === 'xtra' || value === 'all' ? value : null
}

export const SOURCE_VIEW_LABELS: Record<SourceView, string> = { xtra: 'XTRA Sign', crm: 'CRM', all: 'כל המקורות' }

/** A path with `source` spelled out and whatever else the screen keeps. Without a source it is the gate. */
export function withSource(path: string, source: SourceView | null, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams()
  if (source) query.set('source', source)
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * The first thing on a suppliers/customers screen: which records? Two cards,
 * neither chosen for the user. Nothing is listed or counted until one is —
 * a bare address is a question, never a quiet default.
 */
export function SourceGate({
  base,
  plural,
  params = {},
  allowAll = false,
}: {
  base: string
  /** "ספקים" / "לקוחות". */
  plural: string
  /** Query params to carry into the chosen side (a search term, a date range). */
  params?: Record<string, string | undefined>
  /** Reports only: both sources together, shown broken down by source. */
  allowAll?: boolean
}) {
  const cards: { key: CompanySource; label: string; description: string }[] = [
    { key: 'xtra', label: 'XTRA Sign', description: `${plural} שמנוהלים במערכת` },
    { key: 'crm', label: 'CRM', description: `${plural} שמקורם ב-Fireberry` },
  ]
  return (
    <section className="mt-6" aria-labelledby="source-gate">
      <h2 id="source-gate" className="text-base font-semibold text-fg">{`אילו ${plural} להציג?`}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={withSource(base, card.key, params)}
            className="flex min-h-28 flex-col justify-center rounded-[var(--radius-card)] border-2 border-line bg-surface p-5 transition hover:border-brand focus-visible:border-brand"
          >
            <span className="text-xl font-bold text-fg">{card.label}</span>
            <span className="mt-1 text-sm text-muted">{card.description}</span>
          </Link>
        ))}
      </div>
      {allowAll ? (
        <p className="mt-3 text-sm text-muted">
          או{' '}
          <Link href={withSource(base, 'all', params)} className="inline-flex min-h-11 items-center text-brand underline-offset-4 hover:underline">
            כל המקורות
          </Link>{' '}
          — הדוח על שני המקורות יחד, בפירוט לפי מקור.
        </p>
      ) : null}
    </section>
  )
}

/** Above a chosen side: says which, and the one way to change it — back through the gate. Never switches on its own. */
export function SourceBar({
  base,
  source,
  params = {},
}: {
  base: string
  source: SourceView
  params?: Record<string, string | undefined>
}) {
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 rounded-lg border border-line bg-surface px-3 text-sm">
      <span className="text-muted">מקור:</span>
      <span className="font-semibold text-fg">{SOURCE_VIEW_LABELS[source]}</span>
      <span aria-hidden="true" className="text-muted">·</span>
      <Link href={withSource(base, null, params)} className="inline-flex min-h-11 items-center text-brand underline-offset-4 hover:underline">
        החלפה
      </Link>
    </p>
  )
}
