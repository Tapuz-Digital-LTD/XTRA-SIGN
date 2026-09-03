'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ImportRow } from '@/server/companies/excel'

/**
 * Importing companies from a spreadsheet.
 *
 * Upload parses and checks; it does not write. The plan comes back row by row —
 * what will be created, what already exists, what was rejected and why — and a
 * second, explicit press applies it. Somebody's supplier list is not the place
 * to discover afterwards what the system decided to do.
 */
export function ExcelImportDialog({ groupId, groupName }: { groupId?: string; groupName?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ created: number; linked: number; skipped: number } | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/companies/import', { method: 'POST', body: form })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו לקרוא את הקובץ.')
        return
      }
      setRows(data.rows ?? [])
    } catch {
      setError('לא הצלחנו לקרוא את הקובץ.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!rows) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/companies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, groupId: groupId ?? null }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הייבוא נכשל.')
        return
      }
      setDone({ created: data.created, linked: data.linked, skipped: data.skipped })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setRows(null)
          setDone(null)
          setError(null)
          setOpen(true)
        }}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        ייבוא מ-Excel
      </button>
    )
  }

  const counts = {
    new: rows?.filter((r) => r.status === 'new').length ?? 0,
    existing: rows?.filter((r) => r.status === 'existing').length ?? 0,
    invalid: rows?.filter((r) => r.status === 'invalid').length ?? 0,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">ייבוא מ-Excel{groupName ? ` — ${groupName}` : ''}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

          {done ? (
            <div className="py-6 text-center">
              <p className="text-2xl" aria-hidden="true">✓</p>
              <p className="mt-2 text-lg font-semibold text-fg">הייבוא הושלם</p>
              <p className="mt-1 text-sm text-muted">
                נוצרו {done.created} · שויכו {done.linked} קיימות
                {done.skipped > 0 ? ` · דולגו ${done.skipped}` : ''}
              </p>
            </div>
          ) : !rows ? (
            <>
              <ol className="text-sm text-muted">
                <li>1. הורידו את התבנית ומלאו אותה.</li>
                <li>2. העלו את הקובץ — נציג לכם בדיוק מה ייווצר.</li>
                <li>3. רק אז מאשרים.</li>
              </ol>
              {/* A file download, not a page: it must not be prefetched or
                  client-navigated, so it stays a plain anchor. */}
              <a
                href="/api/companies/import"
                download
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
              >
                הורדת תבנית Excel
              </a>

              <label className="mt-4 block cursor-pointer rounded-lg border border-dashed border-line px-4 py-8 text-center transition hover:border-brand">
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(file)
                  }}
                />
                <span className="block text-sm font-medium text-fg">{busy ? 'קורא את הקובץ…' : 'בחירת קובץ Excel'}</span>
                <span className="mt-1 block text-xs text-muted">.xlsx עד 5MB</span>
              </label>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">{counts.new} חדשות</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{counts.existing} כבר קיימות</span>
                {counts.invalid > 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{counts.invalid} נדחו</span> : null}
              </div>

              <table className="mt-3 w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th className="py-2 text-start font-medium">שורה</th>
                    <th className="py-2 text-start font-medium">חברה</th>
                    <th className="py-2 text-start font-medium">סוג</th>
                    <th className="py-2 text-start font-medium">מה יקרה</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line} className="border-b border-line last:border-0">
                      <td className="py-2 text-muted">{row.line}</td>
                      <td className="max-w-[14rem] py-2"><span className="block truncate">{row.name || '—'}</span></td>
                      <td className="py-2 text-muted">{row.kind === 'supplier' ? 'ספק' : 'לקוח'}</td>
                      <td className="py-2">
                        {row.status === 'new' ? (
                          <span className="text-green-800">✅ תיווצר</span>
                        ) : row.status === 'existing' ? (
                          <span className="text-slate-700">⚠ כבר קיימת — נשתמש בקיימת{groupId ? ' ונוסיף לפרויקט' : ''}</span>
                        ) : (
                          <span className="text-red-800">❌ {row.message}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="flex min-h-16 items-center justify-between gap-3 border-t border-line px-4">
          {done ? (
            <button type="button" onClick={() => setOpen(false)} className="ms-auto inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              סיום
            </button>
          ) : rows ? (
            <>
              <button type="button" onClick={() => setRows(null)} className="text-sm text-muted hover:text-fg">בחירת קובץ אחר</button>
              <button
                type="button"
                disabled={busy || counts.new + counts.existing === 0}
                onClick={() => void apply()}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'מייבא…' : `ייבוא ${counts.new + counts.existing} חברות`}
              </button>
            </>
          ) : (
            <span className="text-xs text-muted">שום דבר לא נשמר עד שתאשרו.</span>
          )}
        </div>
      </div>
    </div>
  )
}
