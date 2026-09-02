'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import type { CompanyListItem } from '@/server/companies/companies'

const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The list for one space (suppliers or customers): a search box, the create
 * form, and a table dense enough to scan a few hundred rows. A table rather
 * than cards because with many companies scanning a column beats reading tiles.
 */
export function CompanyList({
  companies,
  kind,
  noun,
  search,
  crmEnabled,
}: {
  companies: CompanyListItem[]
  kind: 'supplier' | 'customer'
  /** "ספק" / "לקוח" */
  noun: string
  search: string
  crmEnabled: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState(search)

  const basePath = kind === 'supplier' ? '/suppliers' : '/customers'
  const pluralNoun = noun === 'ספק' ? 'ספקים' : 'לקוחות'

  function runSearch(value: string) {
    setQuery(value)
    // Debounced navigation would be nicer, but a plain submit keeps the URL the
    // source of truth so the result is shareable and survives a refresh.
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    router.push(query.trim() ? `${basePath}?q=${encodeURIComponent(query.trim())}` : basePath)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">
            +
          </span>
          {`הוספת ${noun}`}
        </button>

        <form onSubmit={submitSearch} className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="company-search" className="sr-only">
            {`חיפוש ${pluralNoun}`}
          </label>
          <input
            id="company-search"
            type="search"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder={`חיפוש ${pluralNoun} לפי שם`}
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
          />
        </form>
      </div>

      {adding ? (
        <CompanyForm
          kind={kind}
          noun={noun}
          crmEnabled={crmEnabled}
          onCancel={() => setAdding(false)}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {companies.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">
            {search.trim() ? `לא נמצאו ${pluralNoun} עבור "${search.trim()}"` : `עדיין אין ${pluralNoun}`}
          </p>
          {!search.trim() ? (
            <p className="mt-1 text-sm text-muted">{`הוסיפו ${noun} ראשון, ואז צרו עבורו מסמך לחתימה.`}</p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-3 text-start font-medium">{noun === 'ספק' ? 'ספק' : 'לקוח'}</th>
                <th className="px-4 py-3 text-start font-medium">איש קשר</th>
                <th className="px-3 py-3 text-center font-medium">מסמכים</th>
                <th className="px-3 py-3 text-center font-medium">נחתמו</th>
                <th className="px-3 py-3 text-center font-medium">ממתינים</th>
                <th className="px-4 py-3 text-start font-medium">פעילות אחרונה</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => router.push(`/companies/${company.id}`)}
                  className="cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-bg"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{company.name}</div>
                    {company.taxId ? (
                      <div className="text-xs text-muted" dir="ltr">
                        ח.פ {company.taxId}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{company.contactName ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-fg">{company.documentCount}</td>
                  <td className="px-3 py-3 text-center text-fg">{company.signedCount}</td>
                  <td className="px-3 py-3 text-center">
                    {company.pendingCount > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {company.pendingCount}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
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
