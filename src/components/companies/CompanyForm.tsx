'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { validateCompanyField, validateCompanyFields, type CompanyField } from '@/lib/company-validation'
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
 *
 * Creating starts with one question — where — because the answer decides what
 * saving does: XTRA Sign only, or also a Fireberry record through the
 * registration service (duplicate check first, then create and link, audited).
 * XTRA Sign is the default. The CRM half is offered only when the connection
 * is configured; otherwise the card says where CRM records come from instead
 * of pretending to be a button.
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
  const [choosing, setChoosing] = useState(!existing)
  /** The explicit yes to "this will also be created in Fireberry". */
  const [confirmed, setConfirmed] = useState(false)
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

  /**
   * Checked when the field is left, not when the form is sent. Finding out at
   * the end that something typed five fields ago was wrong is the complaint
   * this exists to answer.
   */
  const check = (key: keyof Values) => () => {
    if (key === 'contactName' || key === 'notes') return
    const message = validateCompanyField(key as CompanyField, values[key])
    setFieldErrors((current) => ({ ...current, [key]: message ?? '' }))
  }

  async function submit(e: React.FormEvent, extra: Record<string, unknown> = { target }) {
    e.preventDefault()
    const local = validateCompanyFields({
      name: values.name,
      taxId: values.taxId,
      contactPhone: values.contactPhone,
      contactEmail: values.contactEmail,
    })
    if (Object.keys(local).length > 0) {
      setFieldErrors(local as Record<string, string>)
      setError(null)
      return
    }

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

  const choose = (next: 'local' | 'crm') => {
    setTarget(next)
    setConfirmed(false)
    setChoosing(false)
  }

  if (choosing) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h2 className="text-base font-semibold text-fg">{`היכן ליצור את ה${noun}?`}</h2>
        <p className="mt-1 text-sm text-muted">ברירת המחדל היא XTRA Sign. רשומת CRM נוצרת ב-Fireberry ומופיעה כאן ברשימת CRM.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            autoFocus
            onClick={() => choose('local')}
            className="min-h-11 rounded-lg border border-brand bg-blue-50 p-3 text-start transition hover:bg-blue-100"
          >
            <span className="block text-sm font-semibold text-fg">XTRA Sign</span>
            <span className="block text-xs text-muted">{`ה${noun} נשמר כאן בלבד, למסמכים ולחתימות.`}</span>
          </button>
          {crmAvailable ? (
            <button
              type="button"
              onClick={() => choose('crm')}
              className="min-h-11 rounded-lg border border-line bg-white p-3 text-start transition hover:border-brand"
            >
              <span className="block text-sm font-semibold text-fg">CRM</span>
              <span className="block text-xs text-muted">{`ה${noun} ייווצר גם ב-Fireberry ויקושר לרשומה כאן.`}</span>
            </button>
          ) : (
            <div className="rounded-lg border border-dashed border-line p-3">
              <span className="block text-sm font-semibold text-fg">CRM</span>
              <span className="block text-xs text-muted">יצירה ב-CRM מתבצעת ב-Fireberry עצמו; הרשומה תסונכרן לכאן בסנכרון הבא.</span>
            </div>
          )}
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="mt-3 min-h-11 rounded-lg border border-line bg-white px-5 text-sm text-fg">
            ביטול
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
    >
      {!existing ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">נוצר ב:</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${target === 'crm' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
            {target === 'crm' ? 'XTRA Sign + Fireberry' : 'XTRA Sign'}
          </span>
          <button type="button" onClick={() => setChoosing(true)} className="min-h-11 px-2 text-xs text-brand underline-offset-4 hover:underline">
            שינוי
          </button>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`שם ה${noun}`} value={values.name} onChange={set('name')} onBlur={check('name')} required autoFocus error={fieldErrors.name} />
        <Field label="ח.פ / ע.מ" value={values.taxId} onChange={set('taxId')} onBlur={check('taxId')} dir="ltr" inputMode="numeric" error={fieldErrors.taxId} />
        <Field label="איש קשר" value={values.contactName} onChange={set('contactName')} />
        <Field label="טלפון" value={values.contactPhone} onChange={set('contactPhone')} onBlur={check('contactPhone')} type="tel" dir="ltr" inputMode="tel" error={fieldErrors.contactPhone} />
        <Field label="אימייל" value={values.contactEmail} onChange={set('contactEmail')} onBlur={check('contactEmail')} type="email" dir="ltr" inputMode="email" error={fieldErrors.contactEmail} />
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


      {target === 'crm' && !existing ? (
        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium text-fg">הרשומה תיווצר גם ב-Fireberry</span>
            <span className="block text-xs text-muted">לפני היצירה נבדוק אם החברה כבר קיימת שם, כדי לא ליצור כפילות ב-CRM.</span>
          </span>
        </label>
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

      {/* Only a message that is not already pinned to a field. */}
      {error && Object.values(fieldErrors).every((m) => m !== error) ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy || (target === 'crm' && !confirmed)}
          className="min-h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'שומר…' : existing ? 'שמירה' : target === 'crm' ? 'יצירה ב-XTRA Sign וב-Fireberry' : `הוספת ${noun}`}
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
  onBlur,
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
  onBlur?: () => void
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
        onBlur={onBlur}
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
