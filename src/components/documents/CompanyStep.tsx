'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm: boolean }

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

/**
 * The first question of a new document: who is it for?
 *
 * One search over suppliers and customers together — the split matters for
 * browsing, not for answering this. A company that does not exist yet is
 * created right here, as an XTRA Sign record with no CRM requirement, because
 * leaving the flow to go make one first is how half-finished documents happen.
 */
export function CompanyStep({ template, crmAvailable }: { template?: string | null; crmAvailable: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // New-company form
  const [kind, setKind] = useState<'supplier' | 'customer'>('supplier')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [taxId, setTaxId] = useState('')
  const [target, setTarget] = useState<'local' | 'crm'>('local')
  const [matches, setMatches] = useState<CrmMatch[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      setLoading(true)
      try {
        const response = await fetch(`/api/companies?q=${encodeURIComponent(query)}&kind=${kind}`)
        const data = await response.json().catch(() => null)
        if (!cancelled && response.ok) setResults(data.companies ?? [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, kind])

  function proceed(companyId: string) {
    const params = new URLSearchParams({ company: companyId })
    if (template) params.set('template', template)
    router.push(`/documents/new?${params.toString()}`)
  }

  /** The details as the API wants them. */
  function payload(extra: Record<string, unknown> = {}) {
    return {
      kind,
      name,
      taxId: taxId || null,
      contactName: contactName || null,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      ...extra,
    }
  }

  async function submit(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        setFieldErrors(data?.error?.fields ?? {})
        return
      }

      if (data.outcome === 'duplicates') {
        setMatches(data.matches ?? [])
        return
      }
      if (data.outcome === 'created_crm_failed') {
        // Saved here, but it is not a CRM company and must not look like one.
        setNotice(data.message)
        proceed(data.id)
        return
      }
      proceed(data.id)
    } catch {
      setError('היצירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function createAndProceed(event: React.FormEvent) {
    event.preventDefault()
    await submit(payload({ target }))
  }

  if (matches) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">נראה שהחברה כבר קיימת ב-Fireberry</h2>
        <p className="mt-1 text-sm text-muted">
          כדי לא ליצור כפילות ב-CRM — בחרו את הרשומה הנכונה, או חזרו לעריכה אם אף אחת לא מתאימה.
        </p>

        <ul className="mt-4 divide-y divide-line">
          {matches.map((match) => (
            <li key={match.crmRecordId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{match.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[
                    match.taxId ? `ח.פ ${match.taxId}` : null,
                    match.contactPhone,
                    match.contactEmail,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'ללא פרטים נוספים'}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{MATCH_REASON[match.matchedOn]}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(payload({ linkCrmRecordId: match.crmRecordId }))}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                קישור לרשומה הזו
              </button>
            </li>
          ))}
        </ul>

        {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setMatches(null)} className="text-sm text-brand underline-offset-4 hover:underline">
            חזרה לעריכה
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(payload({ target: 'local' }))}
            className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
          >
            אף אחת לא מתאימה — שמירה ב-XTRA Sign בלבד
          </button>
        </div>
      </div>
    )
  }

  if (creating) {
    return (
      <form onSubmit={createAndProceed} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">לקוח/ספק חדש</h2>
        <p className="mt-1 text-xs text-muted">
          {crmAvailable
            ? 'כל חברה נשמרת קודם כל ב-XTRA Sign. אפשר גם ליצור או לקשר אותה ל-Fireberry.'
            : 'נשמר ב-XTRA Sign. חיבור ל-Fireberry אינו זמין כרגע.'}
        </p>

        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="סוג">
          {(
            [
              ['supplier', 'ספק'],
              ['customer', 'לקוח'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3 text-sm transition ${
                kind === value ? 'border-brand bg-blue-50 font-semibold text-brand' : 'border-line text-fg hover:border-brand'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm">
          <span className="text-muted">
            שם החברה <span className="text-red-700">*</span>
          </span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setFieldErrors((c) => (c.name ? { ...c, name: '' } : c))
            }}
            required
            aria-invalid={fieldErrors.name ? true : undefined}
            className={`mt-1 h-11 w-full rounded-lg border bg-bg px-3 text-sm text-fg outline-none focus:border-brand ${
              fieldErrors.name ? 'border-red-500' : 'border-line'
            }`}
          />
          {fieldErrors.name ? <span role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.name}</span> : null}
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">איש קשר</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
          </label>
          <label className="block text-sm">
            <span className="text-muted">טלפון</span>
            <input
              value={contactPhone}
              onChange={(e) => {
                setContactPhone(e.target.value)
                setFieldErrors((c) => (c.contactPhone ? { ...c, contactPhone: '' } : c))
              }}
              dir="ltr"
              type="tel"
              inputMode="tel"
              aria-invalid={fieldErrors.contactPhone ? true : undefined}
              className={`mt-1 h-11 w-full rounded-lg border bg-bg px-3 text-sm text-fg outline-none focus:border-brand ${
                fieldErrors.contactPhone ? 'border-red-500' : 'border-line'
              }`}
            />
            {fieldErrors.contactPhone ? <span role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.contactPhone}</span> : null}
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">ח.פ / ע.מ</span>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} dir="ltr" className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
          </label>
          <label className="block text-sm">
            <span className="text-muted">אימייל</span>
            <input
              value={contactEmail}
              onChange={(e) => {
                setContactEmail(e.target.value)
                setFieldErrors((c) => (c.contactEmail ? { ...c, contactEmail: '' } : c))
              }}
              dir="ltr"
              type="email"
              inputMode="email"
              aria-invalid={fieldErrors.contactEmail ? true : undefined}
              className={`mt-1 h-11 w-full rounded-lg border bg-bg px-3 text-sm text-fg outline-none focus:border-brand ${
                fieldErrors.contactEmail ? 'border-red-500' : 'border-line'
              }`}
            />
            {fieldErrors.contactEmail ? <span role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.contactEmail}</span> : null}
          </label>
        </div>

        {crmAvailable ? (
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-fg">איפה לשמור?</legend>
            <div className="mt-2 flex flex-col gap-2">
              {(
                [
                  ['local', 'XTRA Sign בלבד', 'החברה תשמש למסמכים וחתימות במערכת הזו.'],
                  ['crm', 'XTRA Sign + Fireberry CRM', 'החברה תיווצר או תקושר גם ל-Fireberry.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    target === value ? 'border-brand bg-blue-50' : 'border-line hover:border-brand'
                  }`}
                >
                  <input
                    type="radio"
                    name="target"
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

        {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}

        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'יוצר…' : 'יצירה והמשך'}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
            חזרה לחיפוש
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      {notice ? (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}
      <div className="mb-3 flex gap-1 rounded-lg bg-bg p-1" role="tablist" aria-label="סוג חברה">
        {(
          [
            ['supplier', 'ספקים'],
            ['customer', 'לקוחות'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={`min-h-11 flex-1 rounded-md text-sm transition ${
              kind === value ? 'bg-surface font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={kind === 'supplier' ? 'חיפוש ספק — שם, ח.פ או איש קשר' : 'חיפוש לקוח — שם, ח.פ או איש קשר'}
        className="h-12 w-full rounded-lg border border-line bg-bg px-4 text-sm text-fg outline-none focus:border-brand"
      />

      <div className="mt-3 min-h-48">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">מחפש…</p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {query ? (kind === 'supplier' ? 'לא נמצא ספק מתאים.' : 'לא נמצא לקוח מתאים.') : 'התחילו להקליד כדי לחפש.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {results.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={() => proceed(company.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-1 text-start transition hover:bg-bg"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{company.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[company.kind === 'supplier' ? 'ספק' : 'לקוח', company.taxId].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {company.fromCrm ? (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">CRM</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-line px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        {kind === 'supplier' ? '+ יצירת ספק חדש' : '+ יצירת לקוח חדש'}
      </button>
    </div>
  )
}
