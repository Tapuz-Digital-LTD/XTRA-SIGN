'use client'

import { DeleteDialog } from '@/components/deletion/DeleteDialog'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import { LINKED_NOTE, SourceBadge, isLinked, sourceOf } from '@/components/companies/SourceBadge'
import { withSource } from '@/components/companies/SourceSwitch'
import type { CompanyRow } from '@/server/companies/companies'

/**
 * A company's identity and the two actions on it — edit and remove. Kept a
 * client island so the rest of the page stays server-rendered.
 */
export function CompanyHeader({
  company,
  noun,
  crmAppUrl,
  isAdmin,
  startEditing = false,
}: {
  company: CompanyRow
  noun: string
  crmAppUrl: string | null
  isAdmin: boolean
  /** Opened from a list's "עריכה": the form is already showing. */
  startEditing?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(startEditing)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const details = [
    company.taxId ? { label: 'ח.פ / ע.מ', value: company.taxId, dir: 'ltr' as const } : null,
    company.contactName ? { label: 'איש קשר', value: company.contactName } : null,
    company.contactPhone ? { label: 'טלפון', value: company.contactPhone, dir: 'ltr' as const } : null,
    company.contactEmail ? { label: 'אימייל', value: company.contactEmail, dir: 'ltr' as const } : null,
    company.address ? { label: 'כתובת', value: company.address } : null,
  ].filter(Boolean) as { label: string; value: string; dir?: 'ltr' }[]

  async function setArchived(archived: boolean) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'company', id: company.id, mode: archived ? 'archive' : 'restore' }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      setNotice(data?.message ?? null)
      router.refresh()
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }


  if (editing) {
    return (
      <CompanyForm
        kind={company.kind}
        existing={company}
        noun={noun}
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
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
            <span>{noun}</span>
            <SourceBadge company={company} />
          </p>
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
            disabled={busy}
            onClick={() => void setArchived(!company.archivedAt)}
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-fg disabled:opacity-50"
          >
            {company.archivedAt ? 'החזרה מהארכיון' : 'ארכיון'}
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

      {company.crmRecordId ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="font-medium text-blue-800">מחובר ל-Fireberry ✓</span>
          {isLinked(company) ? <span className="text-blue-700/80">{LINKED_NOTE}</span> : null}
          {company.crmSyncedAt ? (
            <span className="text-blue-700/80">
              סונכרן לאחרונה: {new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(company.crmSyncedAt))}
            </span>
          ) : null}
          {crmAppUrl ? (
            <a
              href={`${crmAppUrl}${company.crmObjectType}/${company.crmRecordId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-auto rounded-lg border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
            >
              פתח ב-CRM ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <DeleteDialog
        type="company"
        id={company.id}
        noun={noun as 'ספק' | 'לקוח'}
        isAdmin={isAdmin}
        open={confirming}
        onClose={() => setConfirming(false)}
        onDone={(result) => {
          setConfirming(false)
          if (result.action === 'request' || result.action === 'archive' || result.action === 'restore') {
            setNotice(result.message)
            router.refresh()
            return
          }
          router.push(withSource(company.kind === 'supplier' ? '/suppliers' : '/customers', sourceOf(company)))
          router.refresh()
        }}
      />
    </div>
  )
}
