'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm: boolean }

/**
 * The first question of a new document: who is it for?
 *
 * One search over suppliers and customers together — the split matters for
 * browsing, not for answering this. A company that does not exist yet is
 * created right here, as an XTRA Sign record with no CRM requirement, because
 * leaving the flow to go make one first is how half-finished documents happen.
 */
export function CompanyStep({ template }: { template?: string | null }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // New-company form
  const [kind, setKind] = useState<'supplier' | 'customer'>('supplier')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
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
  }, [query])

  function proceed(companyId: string) {
    const params = new URLSearchParams({ company: companyId })
    if (template) params.set('template', template)
    router.push(`/documents/new?${params.toString()}`)
  }

  async function createAndProceed(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, contactName: contactName || null, contactPhone: contactPhone || null }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        return
      }
      proceed(data.id)
    } catch {
      setError('היצירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <form onSubmit={createAndProceed} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">לקוח/ספק חדש</h2>
        <p className="mt-1 text-xs text-muted">נשמר ב-XTRA Sign. אפשר לחבר ל-Fireberry בהמשך, מתוך כרטיס החברה.</p>

        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="סוג">
          {(
            [
              ['supplier', 'ספק'],
              ['customer', 'לקוח'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3 text-sm transition ${
                kind === value ? 'border-brand bg-blue-50 font-semibold text-brand' : 'border-line text-fg hover:border-brand'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm">
          <span className="text-muted">שם החברה *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">איש קשר</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
          </label>
          <label className="block text-sm">
            <span className="text-muted">טלפון</span>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} dir="ltr" className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
          </label>
        </div>

        {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}

        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'יוצר…' : 'יצירה והמשך'}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
            חזרה לחיפוש
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="חיפוש ספק או לקוח — שם, ח.פ או איש קשר"
        className="h-12 w-full rounded-lg border border-line bg-bg px-4 text-sm text-fg outline-none focus:border-brand"
      />

      <div className="mt-3 min-h-48">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">מחפש…</p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {query ? 'לא נמצאה חברה מתאימה.' : 'התחילו להקליד כדי לחפש.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {results.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={() => proceed(company.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-1 text-start transition hover:bg-bg"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{company.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[company.kind === 'supplier' ? 'ספק' : 'לקוח', company.taxId].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {company.fromCrm ? (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">CRM</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-line px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        + יצירת לקוח/ספק חדש
      </button>
    </div>
  )
}
