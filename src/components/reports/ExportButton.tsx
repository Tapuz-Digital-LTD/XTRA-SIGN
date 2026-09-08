'use client'

import { useState } from 'react'
import type { ReportDefinition } from '@/server/reports/engine/types'

/**
 * "ייצוא לאקסל", beside a table.
 *
 * The file is the table: the same entity, the same conditions, the same
 * columns — built by the report engine, which is the one place that knows
 * how to turn a definition into rows. A screen that shows a list and cannot
 * hand it over as a file is a screen someone has to copy by hand.
 *
 * The export route is a POST (it is real work for the database, and it is
 * rate-limited), so this cannot be a plain link: the response is read as a
 * blob and handed to the browser under the filename the server chose.
 */
export function ExportButton({
  definition,
  label = 'ייצוא לאקסל',
  className,
}: {
  definition: ReportDefinition
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(data?.error?.message ?? 'הייצוא נכשל. נסו שוב.')
      }
      const disposition = response.headers.get('content-disposition') ?? ''
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition)
      const name = match?.[1] ? decodeURIComponent(match[1]) : (match?.[2] ?? 'export.xlsx')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייצוא נכשל. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className={
          className ??
          'inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand disabled:opacity-60'
        }
      >
        {busy ? 'מכין קובץ…' : label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </span>
  )
}
