'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm: boolean }

/**
 * Files a document under a supplier or customer.
 *
 * A document can arrive without one — from a template, or from an upload made
 * outside a company's page — and then it is only findable in the flat document
 * list. This is how it gets attached, including after it has been signed:
 * filing is metadata about where a document belongs, not part of what was
 * signed, so it changes no PDF and no hash.
 */
export function CompanyPicker({
  documentId,
  current,
}: {
  documentId: string
  current: { id: string; name: string } | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Debounced and server-side: 6,600 companies cannot be filtered in the browser.
    // The spinner is turned on inside the timer, not here: setting state
    // synchronously while the effect runs re-renders before the browser paints.
    const timer = setTimeout(async () => {
      if (cancelled) return
      setLoading(true)
      try {
        const response = await fetch(`/api/companies?q=${encodeURIComponent(query)}`)
        const data = await response.json().catch(() => null)
        if (!cancelled && response.ok) setResults(data.companies ?? [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function choose(companyId: string | null) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${documentId}/company`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השיוך נכשל.')
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('השיוך נכשל. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg transition hover:border-brand"
      >
        {current ? 'שינוי שיוך' : 'שיוך לספק/לקוח'}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">שיוך לספק או לקוח</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-bg"
            aria-label="סגירה"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-line px-4 py-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם, ח.פ או איש קשר"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="px-4 py-2 text-sm text-red-800">{error}</p> : null}
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted">מחפש…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">לא נמצאו תוצאות.</p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((company) => (
                <li key={company.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => choose(company.id)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-start transition hover:bg-bg disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{company.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[company.kind === 'supplier' ? 'ספק' : 'לקוח', company.taxId].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {company.fromCrm ? (
                      <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        Fireberry
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {current ? (
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => choose(null)}
              className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
            >
              הסרת השיוך ({current.name})
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
