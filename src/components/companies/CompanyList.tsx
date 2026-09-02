'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import type { CompanyListItem } from '@/server/companies/companies'

const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

type LinkFilter = 'all' | 'crm' | 'local'

/**
 * One space (suppliers or customers): a searchable, dense table.
 *
 * Search is live — it filters name, ח.פ and contact as you type, no button or
 * Enter — over the rows already loaded. A filter separates CRM-linked records
 * (those with a Fireberry id) from ones that live only here, and a badge on
 * every row says which it is.
 */
export function CompanyList({
  companies,
  kind,
  noun,
  crmEnabled,
}: {
  companies: CompanyListItem[]
  kind: 'supplier' | 'customer'
  noun: string
  crmEnabled: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [link, setLink] = useState<LinkFilter>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const pluralNoun = noun === 'ספק' ? 'ספקים' : 'לקוחות'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return companies.filter((c) => {
      if (link === 'crm' && !c.crmRecordId) return false
      if (link === 'local' && c.crmRecordId) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.taxId ?? '').toLowerCase().includes(q) ||
        (c.contactName ?? '').toLowerCase().includes(q) ||
        (c.contactPhone ?? '').includes(q)
      )
    })
  }, [companies, query, link])

  const crmCount = companies.filter((c) => c.crmRecordId).length

  async function sync() {
    setSyncing(true)
    setSyncMsg(null)
    setSyncError(null)
    try {
      const response = await fetch('/api/crm/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setSyncError(data?.error?.message ?? 'הסנכרון נכשל.')
        return
      }
      const c = data.counts
      let msg = `נוספו ${c.added} · עודכנו ${c.updated} · ללא שינוי ${c.unchanged}`
      if (c.failed > 0) msg += ` · נכשלו ${c.failed}`
      if (Array.isArray(data.errors) && data.errors.length > 0) msg += ` — ${data.errors.join(' ')}`
      setSyncMsg(msg)
      router.refresh()
    } catch {
      setSyncError('הסנכרון נכשל. בדקו את החיבור לאינטרנט.')
    } finally {
      setSyncing(false)
    }
  }

  const filters: { key: LinkFilter; label: string }[] = [
    { key: 'all', label: 'הכול' },
    { key: 'crm', label: 'CRM' },
    { key: 'local', label: 'XTRA Sign בלבד' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">+</span>
          {`הוספת ${noun}`}
        </button>

        {crmEnabled ? (
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? 'מסנכרן…' : '↻ סנכרון מ-Fireberry'}
          </button>
        ) : null}

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">⌕</span>
          <label htmlFor="company-search" className="sr-only">{`חיפוש ${pluralNoun}`}</label>
          <input
            id="company-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם, ח.פ או איש קשר"
            className="min-h-11 w-full rounded-lg border border-line bg-surface pe-9 ps-3 text-sm"
          />
        </div>
      </div>

      {crmCount > 0 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="סינון לפי מקור">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={link === f.key}
              onClick={() => setLink(f.key)}
              className={`inline-flex min-h-9 items-center rounded-lg px-3 text-sm transition-colors ${
                link === f.key ? 'bg-brand text-white' : 'text-muted hover:bg-slate-100 hover:text-fg'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {syncMsg ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm text-fg">{syncMsg}</p>
      ) : null}
      {syncError ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm text-danger">{syncError}</p>
      ) : null}

      {adding ? (
        <CompanyForm kind={kind} noun={noun} onCancel={() => setAdding(false)} onDone={() => setAdding(false)} />
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">
            {query.trim() || link !== 'all' ? `לא נמצאו ${pluralNoun} מתאימים` : `עדיין אין ${pluralNoun}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {query.trim()
              ? 'נסו חיפוש אחר, או נקו את הסינון.'
              : link !== 'all'
                ? 'שנו את הסינון למעלה.'
                : `הוסיפו ${noun} ראשון${crmEnabled ? ', או סנכרנו מ-Fireberry' : ''}, ואז צרו עבורו מסמך.`}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[44rem] text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-3 text-start font-medium">{noun === 'ספק' ? 'ספק' : 'לקוח'}</th>
                <th className="px-4 py-3 text-start font-medium">ח.פ / ע.מ</th>
                <th className="px-4 py-3 text-start font-medium">איש קשר</th>
                <th className="px-3 py-3 text-center font-medium">מסמכים</th>
                <th className="px-3 py-3 text-center font-medium">ממתינים</th>
                <th className="px-4 py-3 text-start font-medium">מקור</th>
                <th className="px-4 py-3 text-start font-medium">פעילות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => router.push(`/companies/${company.id}`)}
                  className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-bg"
                >
                  <td className="px-4 py-3 font-medium text-fg">{company.name}</td>
                  <td className="px-4 py-3 text-muted" dir="ltr">{company.taxId ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{company.contactName ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-fg">{company.documentCount}</td>
                  <td className="px-3 py-3 text-center">
                    {company.pendingCount > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{company.pendingCount}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {company.crmRecordId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">CRM</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">XTRA Sign בלבד</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {company.lastActivityAt ? formatter.format(company.lastActivityAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
