'use client'

import { useState } from 'react'
import type { FieldMeta, ReportDefinition } from '@/server/reports/engine/types'
import { Dialog } from './Dialog'
import { btnPrimary, btnSecondary, fieldClass } from './shared'

/**
 * Excel of the report: everything the filter found, or only the chosen
 * rows, with the columns on screen and any extra ones for the file alone.
 */
export function ExportDialog({ open, onClose, definition, total, selectedIds, fields }: { open: boolean; onClose: () => void; definition: ReportDefinition; total: number; selectedIds: string[]; fields: FieldMeta[] }) {
  const [scope, setScope] = useState<'all' | 'selected'>(selectedIds.length > 0 ? 'selected' : 'all')
  const [extra, setExtra] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const candidates = fields.filter((f) => !definition.columns.includes(f.key) && (!q || f.label.toLowerCase().includes(q)))

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const body = { ...definition, extraColumns: extra, ...(scope === 'selected' ? { ids: selectedIds } : {}) }
      const response = await fetch('/api/reports/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error?.message ?? (response.status === 404 ? 'הייצוא עדיין לא זמין.' : 'הייצוא נכשל.'))
      }
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition') ?? '')
      const name = match?.[1] ? decodeURIComponent(match[1]) : (match?.[2] ?? 'report.xlsx')
      const url = URL.createObjectURL(await response.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייצוא נכשל.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="ייצוא לאקסל"
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            ביטול
          </button>
          <button type="button" onClick={() => void download()} disabled={busy || (scope === 'selected' && selectedIds.length === 0)} className={btnPrimary}>
            {busy ? 'מכין קובץ…' : 'הורדת הקובץ'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">הקובץ יכיל את העמודות שנבחרו לדוח, ואפשר להוסיף עמודות לקובץ בלבד.</p>
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="text-sm font-semibold text-fg">מה לייצא</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-bg">
          <input type="radio" name="export-scope" checked={scope === 'all'} onChange={() => setScope('all')} className="size-4" />
          כל התוצאות ({total.toLocaleString('he-IL')})
        </label>
        <label className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm ${selectedIds.length ? 'cursor-pointer text-fg hover:bg-bg' : 'text-muted'}`}>
          <input type="radio" name="export-scope" checked={scope === 'selected'} disabled={selectedIds.length === 0} onChange={() => setScope('selected')} className="size-4" />
          הנבחרות ({selectedIds.length.toLocaleString('he-IL')})
        </label>
      </fieldset>
      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-fg">עמודות נוספות לקובץ {extra.length ? `(${extra.length})` : ''}</summary>
        <label htmlFor="export-extra-search" className="sr-only">
          חיפוש עמודה
        </label>
        <input id="export-extra-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש עמודה…" className={`${fieldClass} mt-2`} />
        <div className="mt-2 max-h-56 overflow-y-auto">
          {candidates.map((field) => {
            const on = extra.includes(field.key)
            return (
              <label key={field.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-bg">
                <input type="checkbox" checked={on} onChange={() => setExtra(on ? extra.filter((k) => k !== field.key) : [...extra, field.key])} className="size-4" />
                <span className="min-w-0 flex-1">
                  {field.label}
                  <span className="ms-2 text-xs text-muted">{field.group}</span>
                </span>
              </label>
            )
          })}
          {candidates.length === 0 ? <p className="py-2 text-sm text-muted">אין עמודות נוספות.</p> : null}
        </div>
      </details>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
