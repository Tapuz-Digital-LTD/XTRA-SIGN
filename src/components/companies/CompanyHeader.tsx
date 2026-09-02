'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import type { CompanyRow } from '@/server/companies/companies'

/**
 * A company's identity and the two actions on it — edit and remove. Kept a
 * client island so the rest of the page stays server-rendered.
 */
export function CompanyHeader({ company, noun, crmEnabled }: { company: CompanyRow; noun: string; crmEnabled: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const details = [
    company.taxId ? { label: 'ח.פ / ע.מ', value: company.taxId, dir: 'ltr' as const } : null,
    company.contactName ? { label: 'איש קשר', value: company.contactName } : null,
    company.contactPhone ? { label: 'טלפון', value: company.contactPhone, dir: 'ltr' as const } : null,
    company.contactEmail ? { label: 'אימייל', value: company.contactEmail, dir: 'ltr' as const } : null,
  ].filter(Boolean) as { label: string; value: string; dir?: 'ltr' }[]

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/companies/${company.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error?.message ?? 'המחיקה נכשלה.')
        setBusy(false)
        return
      }
      router.push(company.kind === 'supplier' ? '/suppliers' : '/customers')
      router.refresh()
    } catch {
      setError('המחיקה נכשלה. בדקו את החיבור לאינטרנט.')
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <CompanyForm
        kind={company.kind}
        existing={company}
        noun={noun}
        crmEnabled={crmEnabled}
        onCancel={() => setEditing(false)}
        onDone={() => {
          setEditing(false)
          router.refresh()
        }}
      />
    )
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{noun}</p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-fg">
            {company.name}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-fg"
          >
            עריכה
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-danger"
          >
            מחיקה
          </button>
        </div>
      </div>

      {details.length > 0 ? (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {details.map((d) => (
            <div key={d.label} className="flex gap-2">
              <dt className="text-muted">{d.label}:</dt>
              <dd className="truncate text-fg" dir={d.dir}>
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {company.notes ? (
        <p className="mt-4 whitespace-pre-wrap rounded-lg bg-bg p-3 text-sm text-fg">
          {company.notes}
        </p>
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-red-50 p-3">
          <p className="text-sm text-fg">
            {`למחוק את ${company.name}? המסמכים שנשלחו יישארו, אך ${noun} יוסר מהרשימה.`}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="min-h-11 rounded-lg bg-danger px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'מוחק…' : 'מחיקה'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm text-fg"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
