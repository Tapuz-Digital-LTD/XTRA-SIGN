'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { withReturnTo } from '@/lib/return-to'
import type { FieldMeta, ReportRow, RunRequest, RunResult } from '@/server/reports/engine/types'
import { CellView, cellText } from './cells'
import { btnLink, btnSecondary, PAGE_SIZES } from './shared'

type Props = {
  request: RunRequest
  result: RunResult | null
  loading: boolean
  error: string | null
  fields: FieldMeta[]
  selected: Map<string, ReportRow>
  allMatching: boolean
  onToggle: (row: ReportRow) => void
  onTogglePage: (rows: ReportRow[], on: boolean) => void
  onAllMatching: (on: boolean) => void
  onSort: (field: string) => void
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  onRetry: () => void
  returnTo: string
}

const LINKS: { key: keyof ReportRow['links']; label: string; href: (id: string) => string }[] = [
  { key: 'company', label: 'פתיחת הספק/הלקוח', href: (id) => `/companies/${id}` },
  { key: 'agreement', label: 'פתיחת ההסכם', href: (id) => `/documents/${id}` },
  { key: 'group', label: 'פתיחת הקמפיין', href: (id) => `/projects/${id}` },
]

/**
 * The rows the definition found: a table on wide screens, cards on a phone.
 * Sorting and paging go back to the server; a click on a row opens its
 * whole story in a drawer with the links onward.
 */
export function ResultsTable({ request, result, loading, error, fields, selected, allMatching, onToggle, onTogglePage, onAllMatching, onSort, onPage, onPageSize, onRetry, returnTo }: Props) {
  const [openRow, setOpenRow] = useState<ReportRow | null>(null)
  const columns = result?.columns ?? request.columns.map((key) => fields.find((f) => f.key === key)).filter((f): f is FieldMeta => Boolean(f))
  const rows = result?.rows ?? []
  const total = result?.total ?? 0
  const pageSize = result?.pageSize ?? request.pageSize ?? 25
  const page = result?.page ?? request.page ?? 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pageAllOn = rows.length > 0 && rows.every((r) => allMatching || selected.has(r.id))
  const first = columns[0]
  const fieldOf = (key: string) => columns.find((c) => c.key === key) ?? fields.find((f) => f.key === key)

  const sortMark = (key: string) => (request.sort?.field === key ? (request.sort.dir === 'asc' ? ' ↑' : ' ↓') : '')

  if (error)
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">לא הצלחנו להציג את הדוח.</p>
        <p className="mt-1">{error}</p>
        <button type="button" onClick={onRetry} className={`${btnSecondary} mt-3`}>
          ניסיון נוסף
        </button>
      </div>
    )

  if (loading && !result)
    return (
      <div aria-busy="true" className="flex flex-col gap-2" role="status">
        <span className="sr-only">טוען את הדוח…</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    )

  if (!result) return null

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="font-semibold text-fg" data-testid="results-count">
          {total.toLocaleString('he-IL')} רשומות
        </span>
        {allMatching ? (
          <span className="rounded-full bg-blue-50 px-3 py-1 text-fg">
            נבחרו כל {total.toLocaleString('he-IL')} התואמים ·{' '}
            <button type="button" onClick={() => onAllMatching(false)} className="text-brand underline-offset-4 hover:underline">
              ביטול
            </button>
          </span>
        ) : pageAllOn && total > rows.length ? (
          <button type="button" onClick={() => onAllMatching(true)} className={btnLink}>
            בחר את כל {total.toLocaleString('he-IL')} התואמים
          </button>
        ) : selected.size > 0 ? (
          <span className="text-muted">נבחרו {selected.size} בעמודים שנצפו</span>
        ) : null}
        <label className="ms-auto flex items-center gap-2 text-muted">
          בעמוד
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="min-h-10 rounded-lg border border-line bg-surface px-2 text-sm text-fg">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">לא נמצאו רשומות. נסו להסיר תנאי או לשנות ערך.</p>
      ) : (
        <>
          {/* Wide screens: a compact table. */}
          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg text-xs text-muted">
                <tr>
                  <th className="w-10 px-2 py-2">
                    <input type="checkbox" aria-label="בחירת כל השורות בעמוד" checked={pageAllOn} disabled={allMatching} onChange={(e) => onTogglePage(rows, e.target.checked)} className="size-4" />
                  </th>
                  {columns.map((column) => (
                    <th key={column.key} className="whitespace-nowrap px-3 py-2 text-start font-medium">
                      {column.sortable ? (
                        <button type="button" onClick={() => onSort(column.key)} className="inline-flex min-h-9 items-center text-start hover:text-fg" aria-sort={request.sort?.field === column.key ? (request.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          {column.label}
                          {sortMark(column.key)}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const on = allMatching || selected.has(row.id)
                  return (
                    <tr key={row.id} onClick={() => setOpenRow(row)} className={`cursor-pointer border-t border-line hover:bg-bg ${on ? 'bg-blue-50/60' : ''}`}>
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`בחירת ${cellText(first, first ? row.cells[first.key] : null) || 'שורה'}`} checked={on} disabled={allMatching} onChange={() => onToggle(row)} className="size-4" />
                      </td>
                      {columns.map((column) => (
                        <td key={column.key} className="max-w-64 truncate px-3 py-1.5 text-fg">
                          <CellView field={column} value={row.cells[column.key]} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per row. */}
          <ul className="mt-3 flex flex-col gap-2 md:hidden">
            {rows.map((row) => {
              const on = allMatching || selected.has(row.id)
              return (
                <li key={row.id} className={`rounded-xl border bg-surface p-3 ${on ? 'border-brand bg-blue-50/40' : 'border-line'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" aria-label="בחירת השורה" checked={on} disabled={allMatching} onChange={() => onToggle(row)} className="mt-1 size-5" />
                    <button type="button" onClick={() => setOpenRow(row)} className="min-w-0 flex-1 text-start">
                      <div className="truncate text-base font-semibold text-fg">{first ? cellText(first, row.cells[first.key]) || '—' : '—'}</div>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        {columns.slice(1, 6).map((column) => (
                          <div key={column.key} className="contents">
                            <dt className="text-muted">{column.label}</dt>
                            <dd className="min-w-0 truncate text-fg">
                              <CellView field={column} value={row.cells[column.key]} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={btnSecondary}>
              הקודם
            </button>
            <span className="text-muted">
              עמוד {page} מתוך {pages}
            </span>
            <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className={btnSecondary}>
              הבא
            </button>
          </div>
        </>
      )}

      <Drawer open={openRow !== null} onClose={() => setOpenRow(null)} title={openRow && first ? cellText(first, openRow.cells[first.key]) || 'פרטי השורה' : 'פרטי השורה'}>
        {openRow ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {Object.entries(openRow.cells).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted">{fieldOf(key)?.label ?? key}</dt>
                  <dd className="min-w-0 break-words text-fg">
                    <CellView field={fieldOf(key)} value={value} />
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {LINKS.filter((l) => openRow.links[l.key]).map((l) => (
                <Link key={l.key} href={withReturnTo(l.href(openRow.links[l.key]!), returnTo)} className={btnSecondary}>
                  {l.label}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  )
}
