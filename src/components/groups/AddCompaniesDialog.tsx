'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm: boolean }

/** Adds existing companies to a group, searched server-side. */
export function AddCompaniesDialog({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'supplier' | 'customer'>('supplier')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      setLoading(true)
      try {
        const response = await fetch(`/api/companies?q=${encodeURIComponent(query)}&kind=${kind}`)
        const data = await response.json().catch(() => null)
        if (!cancelled && response.ok) setResults(data.companies ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, kind, open])

  async function add() {
    setBusy(true)
    try {
      await fetch(`/api/groups/${groupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', companyIds: [...chosen] }),
      })
      setOpen(false)
      setChosen(new Set())
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
      >
        + הוספת חברות
      </button>
    )
  }

  const allVisible = results.length > 0 && results.every((r) => chosen.has(r.id))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">הוספת חברות לקבוצה</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>

        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 flex gap-1 rounded-lg bg-bg p-1" role="tablist">
            {([['supplier', 'ספקים'], ['customer', 'לקוחות']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={kind === value}
                onClick={() => setKind(value)}
                className={`min-h-11 flex-1 rounded-md text-sm transition ${kind === value ? 'bg-surface font-semibold text-fg shadow-sm' : 'text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם, ח.פ או איש קשר"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
          {results.length > 0 ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="size-4"
                checked={allVisible}
                onChange={() =>
                  setChosen((c) => {
                    const next = new Set(c)
                    if (allVisible) for (const r of results) next.delete(r.id)
                    else for (const r of results) next.add(r.id)
                    return next
                  })
                }
              />
              בחירת כל {results.length} התוצאות המוצגות
            </label>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">מחפש…</p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">לא נמצאו תוצאות.</p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((company) => (
                <li key={company.id}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0"
                      checked={chosen.has(company.id)}
                      onChange={() =>
                        setChosen((c) => {
                          const next = new Set(c)
                          if (next.has(company.id)) next.delete(company.id)
                          else next.add(company.id)
                          return next
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{company.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[company.kind === 'supplier' ? 'ספק' : 'לקוח', company.taxId].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {company.fromCrm ? <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">CRM</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-16 items-center justify-between gap-3 border-t border-line px-4">
          <span className="text-sm text-muted">נבחרו {chosen.size}</span>
          <button
            type="button"
            disabled={busy || chosen.size === 0}
            onClick={() => void add()}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'מוסיף…' : `הוספה (${chosen.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
