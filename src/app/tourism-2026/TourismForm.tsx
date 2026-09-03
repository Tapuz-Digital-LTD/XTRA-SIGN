'use client'

import { useRef, useState } from 'react'
import { FIELD_IDS, TOURISM_FORM_SLUG, TOURISM_FORM_VERSION } from './config'

/**
 * The campaign form, split in two to keep the approved screen untouched:
 * step 1 is exactly the Ministry reference (business name, tax id, benefit);
 * pressing the CTA opens a small branded dialog for the contact details the
 * reference doesn't show but the follow-up (agreement sending) requires.
 *
 * One submission → one lead: a UUID idempotency key is minted per attempt and
 * kept across retries, so a double click or a network retry can never create
 * two leads. Success is only shown after the server confirmed the write.
 */

type FieldErrors = Record<string, string>

const DIGITS_RE = /^\d{8,9}$/

export function TourismForm({
  formAvailable,
  benefitOptions,
  hasAgreement,
  successMessage,
}: {
  formAvailable: boolean
  benefitOptions: string[]
  hasAgreement: boolean
  successMessage: string | null
}) {
  const [businessName, setBusinessName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [benefit, setBenefit] = useState(benefitOptions[0] ?? '')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [agreementNote, setAgreementNote] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Minted when an attempt starts, kept for its retries, cleared on success.
  const idempotencyKey = useRef<string | null>(null)

  const setField = (id: string, setter: (v: string) => void) => (value: string) => {
    setter(value)
    setErrors((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  function validateStep1(): boolean {
    const next: FieldErrors = {}
    if (!businessName.trim()) next[FIELD_IDS.businessName] = 'שדה חובה'
    const digits = taxId.replace(/[\s-]/g, '')
    if (!digits) next[FIELD_IDS.taxId] = 'שדה חובה'
    else if (!DIGITS_RE.test(digits)) next[FIELD_IDS.taxId] = 'יש להזין ח.פ תקין (8–9 ספרות)'
    if (!benefit) next[FIELD_IDS.benefitType] = 'יש לבחור הטבה'
    setErrors((current) => ({ ...current, ...next }))
    return Object.keys(next).length === 0
  }

  function openStep2(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!validateStep1()) return
    dialogRef.current?.showModal()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: FieldErrors = {}
    if (!contactName.trim()) next[FIELD_IDS.contactName] = 'שדה חובה'
    if (!phone.trim()) next[FIELD_IDS.phone] = 'שדה חובה'
    if (!email.trim()) next[FIELD_IDS.email] = 'שדה חובה'
    if (Object.keys(next).length > 0) {
      setErrors((current) => ({ ...current, ...next }))
      return
    }

    setBusy(true)
    setError(null)
    idempotencyKey.current ??= crypto.randomUUID()

    const params = new URLSearchParams(window.location.search)
    const meta: Record<string, string> = {
      landing_url: window.location.origin + window.location.pathname,
      form_version: TOURISM_FORM_VERSION,
    }
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = params.get(key)
      if (value) meta[key] = value
    }

    try {
      const response = await fetch(`/api/join/${TOURISM_FORM_SLUG}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: {
            [FIELD_IDS.businessName]: businessName,
            [FIELD_IDS.taxId]: taxId.replace(/[\s-]/g, ''),
            [FIELD_IDS.benefitType]: benefit,
            [FIELD_IDS.contactName]: contactName,
            [FIELD_IDS.phone]: phone,
            [FIELD_IDS.email]: email,
          },
          website,
          source: 'tourism_landing',
          idempotencyKey: idempotencyKey.current,
          referrer: document.referrer || null,
          meta,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setErrors(data?.error?.fields ?? {})
        setError(data?.error?.message ?? 'לא הצלחנו לשלוח את הפרטים כרגע. אפשר לנסות שוב.')
        // Step-1 field errors need the dialog out of the way to be seen.
        if (data?.error?.fields && Object.keys(data.error.fields).some((k) => k !== FIELD_IDS.contactName && k !== FIELD_IDS.phone && k !== FIELD_IDS.email)) {
          dialogRef.current?.close()
        }
        return
      }
      idempotencyKey.current = null
      dialogRef.current?.close()
      setDone(true)
    } catch {
      setError('לא הצלחנו לשלוח את הפרטים כרגע. הפרטים שמילאת נשמרו במסך, אפשר לנסות שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="tl-card" aria-live="polite">
        <div className="tl-success">
          <div className="tl-success-badge" aria-hidden="true">
            ✓
          </div>
          <h2 className="tl-success-title">תודה, הפרטים התקבלו בהצלחה</h2>
          <p className="tl-success-sub">{successMessage ?? 'נציגי הפרויקט יצרו איתכם קשר בהמשך.'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="tl-card" aria-labelledby="tl-form-heading">
      <h2 id="tl-form-heading" className="tl-card-heading">
        מעוניין להצטרף ולתת הטבה:
      </h2>
      <div className="tl-card-underline" aria-hidden="true" />

      <form onSubmit={openStep2} noValidate>
        <div className="tl-form-grid">
          <div className="tl-fields">
            <div className="tl-field-row">
              <label htmlFor="tl-business-name">שם בית העסק</label>
              <input
                id="tl-business-name"
                className="tl-input"
                type="text"
                autoComplete="organization"
                value={businessName}
                aria-invalid={errors[FIELD_IDS.businessName] ? 'true' : undefined}
                aria-describedby={errors[FIELD_IDS.businessName] ? 'tl-err-name' : undefined}
                onChange={(e) => setField(FIELD_IDS.businessName, setBusinessName)(e.target.value)}
              />
              {errors[FIELD_IDS.businessName] ? (
                <p id="tl-err-name" className="tl-field-error" role="alert">
                  {errors[FIELD_IDS.businessName]}
                </p>
              ) : null}
            </div>

            <div className="tl-field-row">
              <label htmlFor="tl-tax-id">ח.פ העסק</label>
              <input
                id="tl-tax-id"
                className="tl-input"
                type="text"
                inputMode="numeric"
                value={taxId}
                aria-invalid={errors[FIELD_IDS.taxId] ? 'true' : undefined}
                aria-describedby={errors[FIELD_IDS.taxId] ? 'tl-err-taxid' : undefined}
                onChange={(e) => setField(FIELD_IDS.taxId, setTaxId)(e.target.value)}
              />
              {errors[FIELD_IDS.taxId] ? (
                <p id="tl-err-taxid" className="tl-field-error" role="alert">
                  {errors[FIELD_IDS.taxId]}
                </p>
              ) : null}
            </div>

            <div className="tl-field-row">
              <label htmlFor="tl-benefit">סוג ההטבה</label>
              <select
                id="tl-benefit"
                className="tl-input"
                value={benefit}
                aria-invalid={errors[FIELD_IDS.benefitType] ? 'true' : undefined}
                onChange={(e) => setField(FIELD_IDS.benefitType, setBenefit)(e.target.value)}
              >
                {benefitOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors[FIELD_IDS.benefitType] ? (
                <p className="tl-field-error" role="alert">
                  {errors[FIELD_IDS.benefitType]}
                </p>
              ) : null}
            </div>
          </div>

          <aside className="tl-agreement">
            <img src="/tourism-2026/agreement-icon.webp" alt="" className="tl-agreement-icon" />
            <p className="tl-agreement-text">
              לחתם להסכם
              <br />
              לחתימה
            </p>
            {hasAgreement ? (
              <a className="tl-agreement-btn" href={`/api/join/${TOURISM_FORM_SLUG}/agreement`} download>
                הורד הסכם
              </a>
            ) : (
              <button
                type="button"
                className="tl-agreement-btn"
                onClick={() => setAgreementNote(true)}
              >
                הורד הסכם
              </button>
            )}
            {agreementNote ? <p className="tl-agreement-note">ההסכם יעלה לכאן בקרוב.</p> : null}
          </aside>
        </div>

        {error ? (
          <p className="tl-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="tl-cta" disabled={!formAvailable}>
          מעוניין להשתתף
        </button>
        {!formAvailable ? (
          <p className="tl-error" role="alert">
            הטופס אינו זמין כרגע. נסו שוב מאוחר יותר.
          </p>
        ) : null}
      </form>

      <dialog ref={dialogRef} className="tl-dialog" aria-labelledby="tl-dialog-title">
        <form className="tl-dialog-inner" onSubmit={submit} noValidate>
          <h3 id="tl-dialog-title" className="tl-dialog-title">
            כמעט סיימנו
          </h3>
          <p className="tl-dialog-sub">רק פרטי קשר, כדי שנוכל לחזור אליכם עם ההסכם</p>

          <div className="tl-dialog-field">
            <label htmlFor="tl-contact-name">שם איש קשר</label>
            <input
              id="tl-contact-name"
              className="tl-input"
              type="text"
              autoComplete="name"
              value={contactName}
              aria-invalid={errors[FIELD_IDS.contactName] ? 'true' : undefined}
              onChange={(e) => setField(FIELD_IDS.contactName, setContactName)(e.target.value)}
            />
            {errors[FIELD_IDS.contactName] ? (
              <p className="tl-field-error" role="alert">
                {errors[FIELD_IDS.contactName]}
              </p>
            ) : null}
          </div>

          <div className="tl-dialog-field">
            <label htmlFor="tl-phone">טלפון</label>
            <input
              id="tl-phone"
              className="tl-input"
              type="tel"
              autoComplete="tel"
              value={phone}
              aria-invalid={errors[FIELD_IDS.phone] ? 'true' : undefined}
              onChange={(e) => setField(FIELD_IDS.phone, setPhone)(e.target.value)}
            />
            {errors[FIELD_IDS.phone] ? (
              <p className="tl-field-error" role="alert">
                {errors[FIELD_IDS.phone]}
              </p>
            ) : null}
          </div>

          <div className="tl-dialog-field">
            <label htmlFor="tl-email">אימייל</label>
            <input
              id="tl-email"
              className="tl-input"
              type="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              aria-invalid={errors[FIELD_IDS.email] ? 'true' : undefined}
              onChange={(e) => setField(FIELD_IDS.email, setEmail)(e.target.value)}
            />
            {errors[FIELD_IDS.email] ? (
              <p className="tl-field-error" role="alert">
                {errors[FIELD_IDS.email]}
              </p>
            ) : null}
          </div>

          {/* Honeypot — never shown; a value here means a script filled the form. */}
          <input
            type="text"
            name="website"
            className="tl-honeypot"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          {error ? (
            <p className="tl-field-error" role="alert" style={{ marginTop: 12, textAlign: 'center' }}>
              {error}
            </p>
          ) : null}

          <button type="submit" className="tl-dialog-submit" disabled={busy}>
            {busy ? (
              <>
                <span className="tl-spinner" aria-hidden="true" />
                שולח…
              </>
            ) : (
              'שליחת הפרטים'
            )}
          </button>
          <button type="button" className="tl-dialog-back" onClick={() => dialogRef.current?.close()}>
            חזרה
          </button>
        </form>
      </dialog>
    </section>
  )
}
