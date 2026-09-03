import type { ReportKpis } from '@/server/reports/reports'

/**
 * The whole reports story: a date range, five numbers, and the same thing as
 * an Excel file. Server-rendered — filters travel in the URL, so a filtered
 * report can be linked and reloaded.
 */
export function ReportPanel({
  kpis,
  action,
  exportHref,
  hidden = {},
  values = {},
  showSource = false,
}: {
  kpis: ReportKpis
  /** The page the filter form submits back to. */
  action: string
  exportHref: string
  /** Extra query params the form must carry through (a tab, say). */
  hidden?: Record<string, string>
  values?: { from?: string; to?: string; source?: string }
  showSource?: boolean
}) {
  const tiles: { label: string; value: number | string }[] = [
    { label: 'נשלחו', value: kpis.sent },
    { label: 'נחתמו', value: kpis.signed },
    { label: 'ממתינים', value: kpis.pending },
    { label: 'פגו', value: kpis.expired },
    { label: 'אחוז חתימה', value: kpis.signRate === null ? '—' : `${kpis.signRate}%` },
  ]

  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        {Object.entries(hidden).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label className="text-sm">
          <span className="block text-xs text-muted">מתאריך</span>
          <input
            type="date"
            name="from"
            defaultValue={values.from ?? ''}
            className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">עד תאריך</span>
          <input
            type="date"
            name="to"
            defaultValue={values.to ?? ''}
            className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        {showSource ? (
          <label className="text-sm">
            <span className="block text-xs text-muted">מקור</span>
            <select
              name="source"
              defaultValue={values.source ?? ''}
              className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
            >
              <option value="">הכול</option>
              <option value="crm">CRM</option>
              <option value="xtra">XTRA Sign</option>
            </select>
          </label>
        ) : null}
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
        >
          הצגה
        </button>
        <a
          href={exportHref}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
        >
          ייצוא ל-Excel
        </a>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-line bg-surface p-4">
            <span className="text-sm font-medium text-muted">{tile.label}</span>
            <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-fg">{tile.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
