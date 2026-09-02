'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CompanyRow } from '@/server/companies/companies'

type Values = {
  name: string
  taxId: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  crmRecordId: string
}

/**
 * Create or edit a supplier/customer. The same fields either way; only the
 * endpoint and the copy differ, so one component covers both.
 */
export function CompanyForm({
  kind,
  existing,
  noun,
  crmEnabled,
  onDone,
  onCancel,
}: {
  kind: 'supplier' | 'customer'
  existing?: CompanyRow
  /** "ספק" / "לקוח", for the labels. */
  noun: string
  /** Whether the CRM connection is configured — gates the CRM record id field. */
  crmEnabled?: boolean
  onDone?: (id: string) => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [values, setValues] = useState<Values>({
    name: existing?.name ?? '',
    taxId: existing?.taxId ?? '',
    contactName: existing?.contactName ?? '',
    contactPhone: existing?.contactPhone ?? '',
    contactEmail: existing?.contactEmail ?? '',
    notes: existing?.notes ?? '',
    crmRecordId: existing?.crmRecordId ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const url = existing ? `/api/companies/${existing.id}` : '/api/companies'
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing ? values : { ...values, kind }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      router.refresh()
      onDone?.(data?.id ?? existing?.id)
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`שם ה${noun}`} value={values.name} onChange={set('name')} required autoFocus />
        <Field label="ח.פ / ע.מ" value={values.taxId} onChange={set('taxId')} dir="ltr" />
        <Field label="איש קשר" value={values.contactName} onChange={set('contactName')} />
        <Field label="טלפון" value={values.contactPhone} onChange={set('contactPhone')} type="tel" dir="ltr" />
        <Field label="אימייל" value={values.contactEmail} onChange={set('contactEmail')} type="email" dir="ltr" />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-xs font-medium text-fg">
          הערות
        </label>
        <textarea
          id="notes"
          value={values.notes}
          onChange={set('notes')}
          rows={3}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
        />
      </div>

      {crmEnabled ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg">מזהה רשומה ב-CRM</label>
          <input
            type="text"
            value={values.crmRecordId}
            onChange={set('crmRecordId')}
            dir="ltr"
            placeholder="GUID של הרשומה ב-Fireberry"
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-start text-sm"
          />
          <p className="text-xs text-muted">
            מאפשר להעלות הסכם חתום ישירות לרשומה של ה{noun} ב-CRM בלחיצה אחת.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'שומר…' : existing ? 'שמירה' : `הוספת ${noun}`}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-line bg-white px-5 text-sm text-fg"
          >
            ביטול
          </button>
        ) : null}
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  dir,
  required,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  dir?: 'ltr'
  required?: boolean
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-fg">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        dir={dir}
        required={required}
        autoFocus={autoFocus}
        className="min-h-11 rounded-lg border border-line bg-white px-3 text-start text-sm"
      />
    </div>
  )
}
