'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CompanyRow } from '@/server/companies/companies'

type CrmMatch = {
  crmRecordId: string
  name: string
  taxId: string | null
  contactPhone: string | null
  contactEmail: string | null
  matchedOn: 'taxId' | 'email' | 'phone' | 'name'
}

/** Why a record was suggested — a name alone is a hint, and says so. */
const MATCH_REASON: Record<CrmMatch['matchedOn'], string> = {
  taxId: 'התאמה לפי ח.פ/ע.מ',
  email: 'התאמה לפי אימייל',
  phone: 'התאמה לפי טלפון',
  name: 'שם דומה — ייתכן שזו חברה אחרת',
}

type Values = {
  name: string
  taxId: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
}

/**
 * Create or edit a supplier/customer. The same fields either way; only the
 * endpoint and the copy differ, so one component covers both.
 */
export function CompanyForm({
  kind,
  existing,
  noun,
  crmAvailable = false,
  onDone,
  onCancel,
}: {
  kind: 'supplier' | 'customer'
  existing?: CompanyRow
  /** "ספק" / "לקוח", for the labels. */
  noun: string
  /** Whether a Fireberry record can be created or linked at all. */
  crmAvailable?: boolean
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
  })
  const [target, setTarget] = useState<'local' | 'crm'>('local')
  const [matches, setMatches] = useState<CrmMatch[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    // The message goes as soon as the field is touched again, rather than
    // sitting there while someone fixes exactly what it complained about.
    setFieldErrors((current) => (current[key] ? { ...current, [key]: '' } : current))
  }

  async function submit(e: React.FormEvent, extra: Record<string, unknown> = { target }) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const url = existing ? `/api/companies/${existing.id}` : '/api/companies'
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing ? values : { ...values, kind, ...extra }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        setFieldErrors(data?.error?.fields ?? {})
        return
      }

      // Nothing was written yet — the CRM already has a candidate.
      if (data?.outcome === 'duplicates') {
        setMatches(data.matches ?? [])
        return
      }
      // Saved here, refused there. Say so rather than implying it is in the CRM.
      if (data?.outcome === 'created_crm_failed') setNotice(data.message)

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
        <Field label={`שם ה${noun}`} value={values.name} onChange={set('name')} required autoFocus error={fieldErrors.name} />
        <Field label="ח.פ / ע.מ" value={values.taxId} onChange={set('taxId')} dir="ltr" inputMode="numeric" error={fieldErrors.taxId} />
        <Field label="איש קשר" value={values.contactName} onChange={set('contactName')} />
        <Field label="טלפון" value={values.contactPhone} onChange={set('contactPhone')} type="tel" dir="ltr" inputMode="tel" error={fieldErrors.contactPhone} />
        <Field label="אימייל" value={values.contactEmail} onChange={set('contactEmail')} type="email" dir="ltr" inputMode="email" error={fieldErrors.contactEmail} />
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


      {crmAvailable && !existing ? (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-fg">איפה לשמור?</legend>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            {(
              [
                ['local', 'XTRA Sign בלבד', `ה${noun} ישמש למסמכים וחתימות במערכת הזו.`],
                ['crm', 'XTRA Sign + Fireberry CRM', `ה${noun} ייווצר או יקושר גם ל-Fireberry.`],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${
                  target === value ? 'border-brand bg-blue-50' : 'border-line hover:border-brand'
                }`}
              >
                <input
                  type="radio"
                  name="company-target"
                  className="mt-0.5 size-4 shrink-0"
                  checked={target === value}
                  onChange={() => setTarget(value)}
                />
                <span>
                  <span className="block text-sm font-medium text-fg">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {matches ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">נראה שהחברה כבר קיימת ב-Fireberry</p>
          <p className="mt-1 text-xs text-amber-900">בחרו את הרשומה הנכונה כדי לא ליצור כפילות ב-CRM.</p>
          <ul className="mt-2 divide-y divide-amber-200">
            {matches.map((match) => (
              <li key={match.crmRecordId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{match.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {[match.taxId ? `ח.פ ${match.taxId}` : null, match.contactPhone, match.contactEmail]
                      .filter(Boolean)
                      .join(' · ') || 'ללא פרטים נוספים'}
                  </span>
                  <span className="block text-xs text-muted">{MATCH_REASON[match.matchedOn]}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => void submit(e as unknown as React.FormEvent, { linkCrmRecordId: match.crmRecordId })}
                  className="min-h-11 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  קישור לרשומה הזו
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => setMatches(null)} className="text-xs text-brand underline-offset-4 hover:underline">
              חזרה לעריכה
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => void submit(e as unknown as React.FormEvent, { target: 'local' })}
              className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
            >
              אף אחת לא מתאימה — שמירה ב-XTRA Sign בלבד
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
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
  error,
  inputMode,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  dir?: 'ltr'
  required?: boolean
  autoFocus?: boolean
  error?: string
  inputMode?: 'tel' | 'numeric' | 'email'
}) {
  const id = `company-${label}`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        dir={dir}
        inputMode={inputMode}
        required={required}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`min-h-11 rounded-lg border bg-white px-3 text-start text-sm ${
          error ? 'border-danger' : 'border-line'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
