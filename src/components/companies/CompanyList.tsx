'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import type { CompanyListItem } from '@/server/companies/companies'

const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The list for one space (suppliers or customers): a card per company with the
 * counts that say whether anything needs attention, plus the create form.
 */
export function CompanyList({
  companies,
  kind,
  noun,
}: {
  companies: CompanyListItem[]
  kind: 'supplier' | 'customer'
  /** "ספק" / "לקוח" */
  noun: string
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-start">
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
      </div>

      {adding ? (
        <CompanyForm
          kind={kind}
          noun={noun}
          onCancel={() => setAdding(false)}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {companies.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">{`עדיין אין ${noun === 'ספק' ? 'ספקים' : 'לקוחות'}`}</p>
          <p className="mt-1 text-sm text-muted">
            {`הוסיפו ${noun} ראשון, ואז צרו עבורו מסמך לחתימה.`}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                href={`/companies/${company.id}`}
                className="flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate text-base font-semibold text-fg">{company.name}</p>
                  {company.pendingCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {company.pendingCount} ממתינים
                    </span>
                  ) : null}
                </div>

                {company.contactName || company.taxId ? (
                  <p className="mt-1 truncate text-xs text-muted">
                    {[company.contactName, company.taxId].filter(Boolean).join(' · ')}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                  <span>
                    <span className="font-medium text-fg">{company.documentCount}</span> מסמכים
                  </span>
                  <span>
                    <span className="font-medium text-fg">{company.signedCount}</span> נחתמו
                  </span>
                  {company.lastActivityAt ? (
                    <span className="ms-auto">{formatter.format(company.lastActivityAt)}</span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
