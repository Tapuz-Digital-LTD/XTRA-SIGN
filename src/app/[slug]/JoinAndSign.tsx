'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SignaturePad } from '@/components/signer/SignaturePad'
import {
  REGISTRATION_LABELS,
  validateRegistration,
  type RegistrationField,
  type RegistrationValues,
} from '@/lib/self-service-registration'
import { AgreementSystemNote, AgreementText } from './AgreementText'
import { track, visitId } from './track'

/**
 * Page 2 — join, read, sign.
 *
 * One page, one button: details → the agreement → the signature → "חתום
 * ושלח". Pressing it registers the business (supplier, project, agreement
 * and signing link are created behind the scenes) and the same page turns
 * into the phone verification; a correct code completes the signature with
 * the drawing held in memory, through XTRA Sign's ordinary engine.
 *
 * `resume` is the same page reached from the SMS or the email after the
 * browser was closed: details locked, signature and code still to do.
 */

const FORM_VERSION = '2026-09-06.1'
/** The engine's consent wording — the same sentence the standard signer shows. */
const CONSENT_TEXT = 'אני מאשר/ת שקראתי את המסמך ושחתימתי ניתנת על ידי מרצוני.'

const FIELD_ORDER: RegistrationField[] = ['businessName', 'taxId', 'phone', 'email', 'signatoryName', 'signatoryRole']

type Step = 'form' | 'otp' | 'finishing' | 'already'

type Props = {
  mode: 'new' | 'resume'
  /** The project's current public address — where the thank-you page lives. */
  slug: string
  /** The project's stable form id — what the register API is addressed by. */
  formId: string
  projectName: string
  token?: string
  values?: RegistrationValues
  verified?: boolean
  maskedPhone?: string
}

type FormValues = Record<RegistrationField, string>

const emptyValues = (): FormValues => ({
  businessName: '',
  taxId: '',
  signatoryName: '',
  signatoryRole: '',
  phone: '',
  email: '',
})

function errorMessage(data: unknown, fallback: string): string {
  const message = (data as { error?: { message?: string } } | null)?.error?.message
  return typeof message === 'string' && message ? message : fallback
}

export function JoinAndSign({ mode, slug, formId, projectName, token: initialToken, values: locked, verified = false, maskedPhone: initialMasked }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<FormValues>(() => (locked ? { ...locked } : emptyValues()))
  const [errors, setErrors] = useState<Partial<Record<RegistrationField, string>>>({})
  const [signature, setSignature] = useState<string | null>(null)
  const [consented, setConsented] = useState(false)
  const [website, setWebsite] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(initialToken ?? null)
  const [maskedPhone, setMaskedPhone] = useState(initialMasked ?? '')
  const [maskedContact, setMaskedContact] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const idempotencyKey = useRef<string | null>(null)
  const otpPanelRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const signatureRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  // Funnel traces: the first keystroke, the first time the code panel opens.
  useEffect(() => {
    if (mode !== 'new' || startedRef.current) return
    if (Object.values(values).some((v) => v.trim())) {
      startedRef.current = true
      track(formId, 'registration_started')
    }
  }, [values, mode, formId])
  useEffect(() => {
    if (step === 'otp') track(formId, 'signing_started', { token: token ?? undefined })
  }, [step, formId, token])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    if (step !== 'otp') return
    otpPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => codeRef.current?.focus(), 350)
  }, [step])

  function setField(field: RegistrationField, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function focusFirstError(fields: Partial<Record<RegistrationField, string>>) {
    const first = FIELD_ORDER.find((f) => fields[f])
    if (first) document.getElementById(`tj-${first}`)?.focus()
  }

  /** "חתום ושלח": everything the page can check, then the server. */
  async function submit() {
    setMessage(null)
    const checked = mode === 'new' ? validateRegistration(values) : ({ ok: true } as const)
    if (!checked.ok) {
      setErrors(checked.fields)
      focusFirstError(checked.fields)
      return
    }
    if (!signature) {
      setMessage('יש לחתום בתיבת החתימה לפני השליחה.')
      signatureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!consented) {
      setMessage('יש לאשר את הצהרת החתימה.')
      signatureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setBusy(true)
    try {
      if (mode === 'resume' && token) {
        if (verified) {
          await complete(token)
        } else {
          await requestCode(token)
          setStep('otp')
        }
        return
      }

      // One key per attempt: a double click or a retry after a timeout
      // reaches the same registration, never a second one.
      idempotencyKey.current ??= crypto.randomUUID()
      const params = new URLSearchParams(window.location.search)
      const meta: Record<string, string> = {
        landing_url: window.location.origin + window.location.pathname,
        form_version: FORM_VERSION,
      }
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
        const value = params.get(key)
        if (value) meta[key] = value
      }

      const response = await fetch(`/api/self-service/${formId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values,
          website,
          idempotencyKey: idempotencyKey.current,
          referrer: document.referrer || null,
          meta,
          visitId: visitId(),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const fields = (data as { error?: { fields?: Partial<Record<RegistrationField, string>> } } | null)?.error?.fields
        if (fields && Object.keys(fields).length > 0) {
          setErrors(fields)
          focusFirstError(fields)
        }
        setMessage(errorMessage(data, 'לא הצלחנו לשלוח את הפרטים כרגע. אפשר לנסות שוב.'))
        return
      }

      if (data.kind === 'already_signed') {
        setMaskedContact(data.maskedContact ?? '')
        setStep('already')
        return
      }

      idempotencyKey.current = null
      setToken(data.token)
      setMaskedPhone(data.maskedPhone ?? '')
      setDevCode(data.otp?.devCode ?? null)
      if (!data.otp?.sent) setMessage(data.otp?.message ?? 'לא הצלחנו לשלוח קוד אימות. אפשר לבקש קוד חדש.')
      setCooldown(30)
      setStep('otp')
    } catch {
      setMessage('לא הצלחנו לשלוח את הפרטים כרגע. הפרטים שמילאת נשמרו במסך, אפשר לנסות שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function requestCode(forToken: string) {
    const response = await fetch(`/api/sign/${forToken}/otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send' }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setMessage(errorMessage(data, 'שליחת הקוד נכשלה.'))
      return
    }
    setMaskedPhone(data?.destination ?? maskedPhone)
    setDevCode(data?.devCode ?? null)
    setCooldown(30)
  }

  async function resend() {
    if (!token || cooldown > 0) return
    setBusy(true)
    setMessage(null)
    try {
      await requestCode(token)
    } catch {
      setMessage('שליחת הקוד נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!token) return
    const supplied = code.trim()
    if (!/^\d{6}$/.test(supplied)) {
      setMessage('יש להזין את 6 הספרות שנשלחו אליך.')
      codeRef.current?.focus()
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/sign/${token}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code: supplied }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(errorMessage(data, 'קוד שגוי. נסו שנית.'))
        codeRef.current?.select()
        return
      }
      await complete(token)
    } catch {
      setMessage('האימות נכשל. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  /** The signature held in memory meets the verified session. */
  async function complete(forToken: string) {
    if (!signature) return
    setStep('finishing')
    const response = await fetch(`/api/sign/${forToken}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature, method: 'drawn', consent: CONSENT_TEXT }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setStep('otp')
      setMessage(errorMessage(data, 'החתימה נכשלה. נסו שוב.'))
      return
    }
    router.replace(`/${slug}/thanks/${forToken}`)
  }

  const lockedMode = mode === 'resume'
  const frozen = step !== 'form' || busy

  if (step === 'already') {
    return (
      <Panel>
        <p className="tj-big-check" aria-hidden="true">
          ✓
        </p>
        <h1 className="tj-h1">ההרשמה שלכם כבר הושלמה וההסכם נחתם.</h1>
        <p className="tj-lead">
          שלחנו קישור להורדת ההסכם החתום {maskedContact ? `אל ${maskedContact}` : 'לפרטי הקשר שנרשמו'}. לא נוצרה חתימה נוספת.
        </p>
      </Panel>
    )
  }

  return (
    <div className="tj-flow">
      <section className="tj-card">
        <h1 className="tj-h1">הצטרפות ל{projectName}</h1>
        <p className="tj-lead">
          ממלאים את פרטי בית העסק, קוראים את ההסכם, חותמים באצבע ומאמתים בקוד שנשלח לנייד. זה הכול.
        </p>
      </section>

      <form
        className="tj-form"
        data-form-id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 'form') void submit()
        }}
        noValidate
      >
        <section className="tj-card" aria-labelledby="tj-business-heading">
          <h2 id="tj-business-heading" className="tj-h2">פרטי בית העסק</h2>
          <div className="tj-fields">
            <Field id="businessName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="organization" />
            <Field id="taxId" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} inputMode="numeric" dir="ltr" placeholder="לדוגמה 515123456" />
            <Field id="phone" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="tel" inputMode="tel" dir="ltr" autoComplete="tel" placeholder="050-1234567" hint="אליו יישלח קוד האימות לחתימה." />
            <Field id="email" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="email" inputMode="email" dir="ltr" autoComplete="email" />
          </div>
        </section>

        <section className="tj-card" aria-labelledby="tj-signatory-heading">
          <h2 id="tj-signatory-heading" className="tj-h2">מורשה החתימה</h2>
          <div className="tj-fields">
            <Field id="signatoryName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="name" />
            <Field id="signatoryRole" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} placeholder="לדוגמה: בעלים, מנכ״ל" />
          </div>
          {lockedMode ? <p className="tj-hint tj-hint-block">הפרטים נשמרו בהרשמה. לשינוי פרטים יש להירשם מחדש מעמוד הקול הקורא.</p> : null}
        </section>

        <section className="tj-card tj-card-agreement" aria-labelledby="tj-agreement-heading">
          <h2 id="tj-agreement-heading" className="tj-h2">ההסכם</h2>
          <p className="tj-hint tj-hint-lead">זה נוסח ההסכם שעליו אתם חותמים. פרטי העסק והחתימה ייכנסו לתוכו אוטומטית.</p>
          <AgreementText />
          <AgreementSystemNote />
        </section>

        <section className="tj-card" ref={signatureRef} aria-labelledby="tj-signature-heading">
          <h2 id="tj-signature-heading" className="tj-h2">חתימה</h2>
          <p className="tj-hint tj-hint-lead">חתימת מורשה/ת החתימה. התאריך יתמלא אוטומטית ביום החתימה.</p>
          <SignaturePad onChange={setSignature} className={step === 'form' ? '' : 'tj-locked'} />
          <label className="tj-consent">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} disabled={frozen} />
            <span>{CONSENT_TEXT}</span>
          </label>
        </section>

        {/* The honeypot: people never see it; bots fill it. */}
        <div className="tj-honeypot" aria-hidden="true">
          <label>
            אתר
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        {message && step === 'form' ? (
          <p role="alert" className="tj-alert">
            {message}
          </p>
        ) : null}

        {step === 'form' ? (
          <div className="tj-actions">
            <button type="submit" className="tj-primary tj-primary-main" disabled={busy}>
              {busy ? 'שולח…' : lockedMode ? 'חתימה' : 'חתום ושלח'}
            </button>
          </div>
        ) : null}
      </form>

      {step === 'otp' || step === 'finishing' ? (
        <section className="tj-card tj-otp" ref={otpPanelRef} aria-live="polite">
          <h2 className="tj-h2">אימות בנייד</h2>
          <p className="tj-lead">
            שלחנו קוד אימות ל-<span dir="ltr">{maskedPhone || 'הנייד שהוזן'}</span>
          </p>
          {devCode ? (
            <p className="tj-devcode">
              סביבת בדיקה — לא נשלח SMS. הקוד: <strong dir="ltr">{devCode}</strong>
            </p>
          ) : null}
          <label htmlFor="tj-code" className="tj-label">
            קוד בן 6 ספרות
          </label>
          <input
            id="tj-code"
            ref={codeRef}
            className="tj-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void verify()
              }
            }}
            disabled={busy || step === 'finishing'}
          />
          {message ? (
            <p role="alert" className="tj-alert">
              {message}
            </p>
          ) : null}
          <button type="button" className="tj-primary" onClick={() => void verify()} disabled={busy || step === 'finishing'}>
            {step === 'finishing' ? 'חותם…' : busy ? 'מאמת…' : 'אימות והשלמת החתימה'}
          </button>
          <button type="button" className="tj-secondary" onClick={() => void resend()} disabled={busy || cooldown > 0 || step === 'finishing'}>
            {cooldown > 0 ? `שליחת קוד חדש (${cooldown})` : 'לא קיבלתי קוד — שלחו שוב'}
          </button>
        </section>
      ) : null}
    </div>
  )
}

function Field({
  id,
  values,
  errors,
  onChange,
  locked,
  disabled,
  type = 'text',
  hint,
  ...rest
}: {
  id: RegistrationField
  values: FormValues
  errors: Partial<Record<RegistrationField, string>>
  onChange: (field: RegistrationField, value: string) => void
  locked: boolean
  disabled: boolean
  type?: string
  hint?: string
} & Pick<React.InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'dir' | 'autoComplete' | 'placeholder'>) {
  const error = errors[id]
  return (
    <div className="tj-field">
      <label htmlFor={`tj-${id}`} className="tj-label">
        {REGISTRATION_LABELS[id]}
      </label>
      <input
        id={`tj-${id}`}
        name={id}
        type={type}
        value={values[id]}
        onChange={(e) => onChange(id, e.target.value)}
        readOnly={locked}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `tj-${id}-error` : hint ? `tj-${id}-hint` : undefined}
        className={`tj-input${error ? ' tj-input-error' : ''}${locked ? ' tj-input-locked' : ''}`}
        required
        {...rest}
      />
      {error ? (
        <p id={`tj-${id}-error`} className="tj-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`tj-${id}-hint`} className="tj-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tj-flow">
      <section className="tj-card tj-center">{children}</section>
    </div>
  )
}
