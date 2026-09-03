'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LeadItem } from '@/server/projects/leads'

/**
 * The review queue for a project's joining form.
 *
 * Every new lead gets exactly three verbs: approve into a supplier, correct a
 * detail first, or turn it away. Approval reuses everything the person typed —
 * nothing is retyped — and immediately offers the next step: send the
 * agreement.
 */

const FIELD_LABELS: Record<string, string> = {
  name: 'שם החברה',
  taxId: 'ח.פ / ע.מ',
  contactName: 'איש קשר',
  phone: 'טלפון',
  email: 'אימייל',
  address: 'כתובת',
  city: 'עיר',
}

/** In the words the form used when THIS lead was submitted. */
function labelFor(lead: LeadItem, key: string): string {
  return lead.formSnapshot?.find((f) => f.id === key)?.label ?? FIELD_LABELS[key] ?? key
}

const SOURCE_LABELS: Record<string, string> = {
  landing: 'טופס XTRA Sign',
  embed: 'טופס מוטמע',
  api: 'API',
  tourism_landing: 'דף שבוע התיירות',
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function LeadsPanel({ projectId, leads }: { projectId: string; leads: LeadItem[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<LeadItem | null>(null)
  const [approved, setApproved] = useState<{ leadId: string; companyId: string } | null>(null)

  async function act(leadId: string, body: Record<string, unknown>) {
    setBusyId(leadId)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, ...body }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה. נסו שוב.')
        return null
      }
      router.refresh()
      return data
    } catch {
      setError('הפעולה נכשלה. נסו שוב.')
      return null
    } finally {
      setBusyId(null)
    }
  }

  async function approve(lead: LeadItem, useExistingCompanyId?: string) {
    const data = await act(lead.id, { action: 'approve', useExistingCompanyId })
    if (data?.ok && data.companyId) setApproved({ leadId: lead.id, companyId: data.companyId })
  }

  const newLeads = leads.filter((l) => l.status === 'new')
  const reviewed = leads.filter((l) => l.status !== 'new')

  if (leads.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-fg">עדיין אין לידים</p>
        <p className="mt-1 text-sm text-muted">
          כשספק ימלא את טופס ההצטרפות של הפרויקט, הפרטים שלו יופיעו כאן לאישור.
          את הטופס מפעילים בלשונית ההגדרות.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {newLeads.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {newLeads.map((lead) => (
            <li key={lead.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      חדש
                    </span>
                    <span className="truncate text-base font-semibold text-fg">{lead.data.name ?? '—'}</span>
                  </div>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {Object.entries(lead.data)
                      .filter(([key]) => key !== 'name')
                      .map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="shrink-0 text-muted">{labelFor(lead, key)}:</dt>
                          <dd className="min-w-0 truncate text-fg" dir={key === 'phone' || key === 'email' ? 'ltr' : undefined}>
                            {value}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <p className="mt-2 text-xs text-muted">
                    התקבל {dateFormat.format(new Date(lead.createdAt))} · {SOURCE_LABELS[lead.source] ?? lead.source}
                    {lead.referrer ? (
                      <>
                        {' · '}
                        <span dir="ltr" className="break-all">{lead.referrer.replace(/^https?:\/\//, '').slice(0, 60)}</span>
                      </>
                    ) : null}
                  </p>
                  {lead.duplicate ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      נראה שהחברה כבר קיימת במערכת: <strong>{lead.duplicate.name}</strong>
                    </p>
                  ) : null}
                </div>

                {approved?.leadId === lead.id ? (
                  <Link
                    href={`/documents/new?company=${approved.companyId}`}
                    className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    שלח הסכם לחתימה
                  </Link>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {lead.duplicate ? (
                      <button
                        type="button"
                        disabled={busyId === lead.id}
                        onClick={() => void approve(lead, lead.duplicate!.id)}
                        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50"
                      >
                        קשר לחברה הקיימת
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => void approve(lead)}
                      className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busyId === lead.id ? 'מאשר…' : 'אשר והפוך לספק'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => setEditing(lead)}
                      className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50"
                    >
                      ערוך
                    </button>
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => {
                        if (window.confirm('לדחות את הליד? הפרטים יישמרו אך לא ייווצר ספק.')) void act(lead.id, { action: 'reject' })
                      }}
                      className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-red-700 transition hover:border-red-400 disabled:opacity-50"
                    >
                      דחה
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          אין לידים חדשים לטיפול.
        </p>
      )}

      {reviewed.length > 0 ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg">
            לידים שטופלו ({reviewed.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {reviewed.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{lead.data.name ?? '—'}</span>
                  <span className="block text-xs text-muted">
                    {dateFormat.format(new Date(lead.createdAt))}
                  </span>
                </span>
                {lead.status === 'approved' && lead.companyId ? (
                  <Link href={`/companies/${lead.companyId}`} className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 hover:underline">
                    אושר · לספק
                  </Link>
                ) : (
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    נדחה
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? (
        <EditLeadDialog
          lead={editing}
          busy={busyId === editing.id}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const data = await act(editing.id, { action: 'update', values })
            if (data?.ok) setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function EditLeadDialog({
  lead,
  busy,
  onClose,
  onSave,
}: {
  lead: LeadItem
  busy: boolean
  onClose: () => void
  onSave: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const entries = Object.entries(lead.data).filter(([, v]) => typeof v === 'string') as [string, string][]
    return Object.fromEntries(entries)
  })

  const keys = ['name', 'taxId', 'contactName', 'phone', 'email', 'address', 'city']
  const extraKeys = Object.keys(values).filter((k) => !keys.includes(k))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(values)
        }}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
      >
        <h2 className="text-base font-semibold text-fg">עריכת פרטי הליד</h2>
        {[...keys, ...extraKeys].map((key) => (
          <label key={key} className="mt-3 block text-sm">
            <span className="text-muted">
              {labelFor(lead, key)}
              {key === 'name' ? <span className="text-red-700"> *</span> : null}
            </span>
            <input
              value={values[key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              required={key === 'name'}
              dir={key === 'phone' || key === 'email' ? 'ltr' : undefined}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
            />
          </label>
        ))}
        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={busy || !values.name?.trim()}
            className="min-h-11 flex-1 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm text-fg">
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
