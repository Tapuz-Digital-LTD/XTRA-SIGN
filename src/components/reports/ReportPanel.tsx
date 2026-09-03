import Link from 'next/link'
import { StatusBadge } from '@/components/StatusBadge'
import type { ReportKpis, ReportRow } from '@/server/reports/reports'

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The whole reports story: a date range, five numbers, the rows behind them,
 * and the same thing as an Excel file. Server-rendered — filters travel in
 * the URL, so a filtered report can be linked and reloaded.
 */
export function ReportPanel({
  kpis,
  rows,
  rowLimit,
  series = [],
  action,
  exportHref,
  hidden = {},
  values = {},
  showSource = false,
}: {
  kpis: ReportKpis
  /** The agreements the numbers above counted, newest first. */
  rows: ReportRow[]
  /** How many rows the screen was asked for — at the cap, the export has more. */
  rowLimit: number
  /** Signed per week, for the progress chart. */
  series?: { week: Date; signed: number }[]
  /** The page the filter form submits back to. */
  action: string
  exportHref: string
  /** Extra query params the form must carry through (a tab, say). */
  hidden?: Record<string, string>
  values?: { from?: string; to?: string; source?: string; status?: string }
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
        <label className="text-sm">
          <span className="block text-xs text-muted">סטטוס</span>
          <select
            name="status"
            defaultValue={values.status ?? ''}
            className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          >
            <option value="">הכול</option>
            <option value="signed">נחתמו</option>
            <option value="pending">ממתינים</option>
            <option value="expired">פגו</option>
            <option value="canceled">בוטלו</option>
          </select>
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

      {kpis.sent > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <StatusChart kpis={kpis} />
          {series.length > 0 ? <ProgressChart series={series} /> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-muted">
          אין הסכמים שנשלחו בטווח הזה.
        </p>
      ) : (
        <>
          {/* Phones get cards; the table needs six columns. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <li key={row.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <Link href={`/documents/${row.id}`} className="block truncate text-sm font-medium text-fg hover:underline">
                      {row.title}
                    </Link>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[row.companyName, row.recipientName].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {row.sentAt ? `נשלח ${dateFormat.format(row.sentAt)}` : ''}
                  {row.completedAt ? ` · נחתם ${dateFormat.format(row.completedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface sm:block">
            <table className="w-full min-w-[52rem] table-fixed text-start text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="w-[26%] px-4 py-3 text-start font-medium">מסמך</th>
                  <th className="w-[20%] px-4 py-3 text-start font-medium">חברה</th>
                  <th className="w-[16%] px-4 py-3 text-start font-medium">נמען</th>
                  <th className="w-[14%] px-4 py-3 text-start font-medium">סטטוס</th>
                  <th className="w-[12%] px-4 py-3 text-start font-medium">נשלח</th>
                  <th className="w-[12%] px-4 py-3 text-start font-medium">נחתם</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0 hover:bg-bg">
                    <td className="truncate px-4 py-3">
                      <Link href={`/documents/${row.id}`} className="font-medium text-fg hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="truncate px-4 py-3 text-muted">
                      {row.companyName ?? '—'}
                      {row.companyName ? (
                        <span className="ms-1.5 text-xs">{row.crmRecordId ? '· CRM' : ''}</span>
                      ) : null}
                    </td>
                    <td className="truncate px-4 py-3 text-muted">{row.recipientName ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="truncate px-4 py-3 text-xs text-muted">{row.sentAt ? dateFormat.format(row.sentAt) : '—'}</td>
                    <td className="truncate px-4 py-3 text-xs text-muted">{row.completedAt ? dateFormat.format(row.completedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length >= rowLimit ? (
            <p className="text-xs text-muted">
              מוצגים {rowLimit} ההסכמים האחרונים — הייצוא ל-Excel כולל את כולם.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Status breakdown: one thin bar per state. Identity is carried by the Hebrew
 * label and the number — the status colors (the same ones the badges use)
 * only reinforce it, never carry it alone.
 */
function StatusChart({ kpis }: { kpis: ReportKpis }) {
  const rows = [
    { label: 'נחתמו', value: kpis.signed, bar: 'bg-green-600' },
    { label: 'ממתינים', value: kpis.pending, bar: 'bg-amber-500' },
    { label: 'פגו', value: kpis.expired, bar: 'bg-red-500' },
    { label: 'בוטלו', value: kpis.canceled, bar: 'bg-slate-400' },
  ]
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      <figcaption className="text-sm font-semibold text-fg">סטטוסים</figcaption>
      <div className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-sm" title={`${row.label}: ${row.value}`}>
            <span className="w-16 shrink-0 text-muted">{row.label}</span>
            <span className="w-8 shrink-0 text-end font-medium tabular-nums text-fg">{row.value}</span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg">
              <span
                className={`block h-full rounded-full ${row.bar}`}
                style={{ width: `${Math.round((row.value / max) * 100)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

const weekFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' })

/** Signed per week — one series, one axis, thin rounded columns. */
function ProgressChart({ series }: { series: { week: Date; signed: number }[] }) {
  const max = Math.max(...series.map((s) => s.signed), 1)
  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      <figcaption className="text-sm font-semibold text-fg">חתימות לאורך זמן</figcaption>
      <div className="mt-3 flex h-28 items-end gap-1 border-b border-line pb-px" dir="ltr">
        {series.map((point) => (
          <div
            key={point.week.toISOString()}
            className="flex h-full min-w-0 flex-1 items-end justify-center"
            title={`שבוע ${weekFormat.format(point.week)}: ${point.signed} נחתמו`}
          >
            <span
              className="w-full max-w-6 rounded-t bg-brand"
              style={{ height: `${Math.max(Math.round((point.signed / max) * 100), 4)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted" dir="ltr">
        <span>{weekFormat.format(series[0].week)}</span>
        {series.length > 1 ? <span>{weekFormat.format(series[series.length - 1].week)}</span> : null}
      </div>
    </figure>
  )
}
