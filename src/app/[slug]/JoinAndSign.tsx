'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SignaturePad } from '@/components/signer/SignaturePad'
import {
  REDEMPTION_METHODS,
  REGISTRATION_LABELS,
  TOURISM_WEEKS,
  validateRegistration,
  type RedemptionMethod,
  type RegistrationField,
  type RegistrationValues,
  type TourismWeekId,
} from '@/lib/self-service-registration'
import { AgreementSystemNote, AgreementTerms } from './AgreementText'
import { track, visitId } from './track'
import { OtpInput } from '@/components/ui/OtpInput'
import { useCaptcha } from '@/components/captcha/useCaptcha'
import { CAPTCHA_ACTIONS, type CaptchaPublicConfig } from '@/lib/captcha'

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
  captcha?: CaptchaPublicConfig | null
  token?: string
  values?: RegistrationValues
  verified?: boolean
  maskedPhone?: string
}

/**
 * The form's own shape: the agreement's values, with the two choices allowed
 * to be unmade. Nothing is pre-selected — a week, a redemption method and the
 * two declarations are the business's to state, never ours to assume.
 */
type FormValues = Omit<RegistrationValues, 'week' | 'redemption'> & {
  week: TourismWeekId | ''
  redemption: RedemptionMethod | ''
}

const emptyValues = (): FormValues => ({
  businessName: '',
  taxId: '',
  commercialName: '',
  signatoryName: '',
  signatoryRole: '',
  phone: '',
  email: '',
  benefit1: '',
  benefit2: '',
  benefit3: '',
  benefitNotes: '',
  week: '',
  redemption: '',
  couponCode: '',
  optionalExtension: false,
  declareLicense: false,
  declareInsurance: false,
})

function errorMessage(data: unknown, fallback: string): string {
  const message = (data as { error?: { message?: string } } | null)?.error?.message
  return typeof message === 'string' && message ? message : fallback
}

export function JoinAndSign({ mode, slug, formId, projectName, captcha, token: initialToken, values: locked, verified = false, maskedPhone: initialMasked }: Props) {
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
  const signatureRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const { getToken } = useCaptcha(captcha)

  // Funnel traces: the first keystroke, the first time the code panel opens.
  useEffect(() => {
    if (mode !== 'new' || startedRef.current) return
    if (Object.values(values).some((v) => (typeof v === 'string' ? v.trim() : v))) {
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
  }, [step])

  function setField(field: RegistrationField, value: string | boolean) {
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
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'xs_inv']) {
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
          captchaToken: (await getToken(CAPTCHA_ACTIONS.CAMPAIGN_REGISTRATION)) ?? '',
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
            <Field id="commercialName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} hint="אם העסק פועל תחת שם אחר מזה של החברה." />
            <Field id="email" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="email" inputMode="email" dir="ltr" autoComplete="email" />
            <Field id="phone" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="tel" inputMode="tel" dir="ltr" autoComplete="tel" placeholder="050-1234567" hint="אליו יישלח קוד האימות לחתימה." />
          </div>
          <p className="tj-hint tj-hint-block">
            בית העסק מביע בזאת את רצונו להצטרף כבית עסק משתתף במסגרת פרויקט &quot;חודש התיירות הישראלית&quot; שיתקיים בחודש נובמבר 2026
          </p>
        </section>

        <section className="tj-card" aria-labelledby="tj-benefit-heading">
          <h2 id="tj-benefit-heading" className="tj-h2">פרטי ההטבה</h2>
          <p className="tj-hint tj-hint-lead">
            בית העסק יעניק הטבה בלעדית של 25% הנחה ומעלה מהאתר המקוון של בית העסק עבור לקוחות שיגיעו דרך הפרסום באתר המיזם.
          </p>
          <p className="tj-legend">סוג ההטבה: (מ־25% הנחה ומעלה)</p>
          <div className="tj-fields tj-fields-single">
            <Field id="benefit1" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="1." />
            <Field id="benefit2" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="2." />
            <Field id="benefit3" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="3." />
            <Field id="benefitNotes" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} multiline />
          </div>
        </section>

        <fieldset className="tj-card" disabled={frozen}>
          <legend className="tj-h2">קוד קופון / מימוש - נא לסמן את הבחירה</legend>
          <div className="tj-choices">
            <label className={`tj-choice${values.redemption === 'generic_xtra25' ? ' tj-choice-on' : ''}`}>
              <input
                type="radio"
                name="redemption"
                checked={values.redemption === 'generic_xtra25'}
                onChange={() => setField('redemption', 'generic_xtra25')}
              />
              <span className="tj-choice-body">
                <span className="tj-choice-title">קוד גנרי</span>
                <span className="tj-coupon">XTRA25</span>
              </span>
            </label>
            <label className={`tj-choice${values.redemption === 'business_pos_code' ? ' tj-choice-on' : ''}`}>
              <input
                type="radio"
                name="redemption"
                checked={values.redemption === 'business_pos_code'}
                onChange={() => setField('redemption', 'business_pos_code')}
              />
              <span className="tj-choice-body">
                <span className="tj-choice-title">קוד קופון על פי קופת בית העסק</span>
              </span>
            </label>
          </div>
          {values.redemption === 'business_pos_code' ? (
            <div className="tj-fields tj-fields-single tj-choice-detail">
              <Field id="couponCode" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} dir="ltr" />
            </div>
          ) : null}
          {errors.redemption ? (
            <p role="alert" className="tj-error">
              {errors.redemption}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="tj-card" disabled={frozen}>
          <legend className="tj-h2">תקופת ההתחייבות</legend>
          <p className="tj-hint tj-hint-lead">
            ההטבה הנ״ל מחייבת במהלך שבוע התיירות האזורי שבו משתתף בית העסק, בפרט מיום רביעי ועד מוצ״ש באותו השבוע.
          </p>
          <p className="tj-legend">תאריכי ההטבה ע״פ אזורי חלוקה - נובמבר 2026</p>
          <div className="tj-weeks">
            {TOURISM_WEEKS.map((week) => (
              <label key={week.id} className={`tj-week${values.week === week.id ? ' tj-week-on' : ''}`}>
                <input type="radio" name="week" checked={values.week === week.id} onChange={() => setField('week', week.id)} />
                <span className="tj-week-body">
                  <span className="tj-week-head">
                    <span className="tj-week-title">{week.title}</span>
                    <span className="tj-week-dates" dir="ltr">{week.dates}</span>
                  </span>
                  <span className="tj-week-regions">{week.regions}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.week ? (
            <p role="alert" className="tj-error">
              {errors.week}
            </p>
          ) : null}
          <label className="tj-consent tj-consent-block">
            <input type="checkbox" checked={values.optionalExtension} onChange={(e) => setField('optionalExtension', e.target.checked)} />
            <span>
              הרחבה אופציונלית: במידה ובית העסק יבחר בכך (על פי שיקול דעתו הבלעדי), יורשה להעניק את ההטבה לכלל פעילות שאר האזורים
              בארץ לאורך כל חודש התיירות הישראלית (11.2026).
            </span>
          </label>
        </fieldset>

        <section className="tj-card tj-card-agreement" aria-labelledby="tj-agreement-heading">
          <h2 id="tj-agreement-heading" className="tj-h2">תנאים והגבלות למימוש ההטבה</h2>
          <AgreementTerms />
        </section>

        <fieldset className="tj-card" disabled={frozen}>
          <legend className="tj-h2">הצהרות ואישורים</legend>
          <label className="tj-consent tj-consent-block">
            <input type="checkbox" checked={values.declareLicense} onChange={(e) => setField('declareLicense', e.target.checked)} />
            <span>הנני מצהיר/ה כי ברשות בית העסק רישיון עסק תקף כחוק.</span>
          </label>
          {errors.declareLicense ? (
            <p role="alert" className="tj-error">
              {errors.declareLicense}
            </p>
          ) : null}
          <label className="tj-consent tj-consent-block">
            <input type="checkbox" checked={values.declareInsurance} onChange={(e) => setField('declareInsurance', e.target.checked)} />
            <span>הנני מצהיר/ה כי ברשות בית העסק פוליסת ביטוח בתוקף.</span>
          </label>
          {errors.declareInsurance ? (
            <p role="alert" className="tj-error">
              {errors.declareInsurance}
            </p>
          ) : null}
        </fieldset>

        <section className="tj-card" aria-labelledby="tj-signatory-heading">
          <h2 id="tj-signatory-heading" className="tj-h2">חתימת בית העסק</h2>
          <div className="tj-fields">
            <Field id="signatoryName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="name" />
            <Field id="signatoryRole" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} placeholder="לדוגמה: בעלים, מנכ״ל" />
          </div>
          {lockedMode ? <p className="tj-hint tj-hint-block">הפרטים נשמרו בהרשמה. לשינוי פרטים יש להירשם מחדש מעמוד הקול הקורא.</p> : null}
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
          <p className="tj-label">קוד בן 6 ספרות</p>
          <div className="tj-code">
            <OtpInput id="tj-code" label="קוד אימות" value={code} onChange={setCode} onComplete={() => void verify()} disabled={busy || step === 'finishing'} invalid={Boolean(message)} />
          </div>
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
  numbered,
  multiline,
  ...rest
}: {
  id: RegistrationField
  values: FormValues
  errors: Partial<Record<RegistrationField, string>>
  onChange: (field: RegistrationField, value: string | boolean) => void
  locked: boolean
  disabled: boolean
  type?: string
  hint?: string
  /** The document numbers its benefit lines 1., 2., 3.; the label goes with it. */
  numbered?: string
  multiline?: boolean
} & Pick<React.InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'dir' | 'autoComplete' | 'placeholder'>) {
  const error = errors[id]
  const raw = values[id]
  const value = typeof raw === 'string' ? raw : ''
  // Only the fields the agreement insists on are required; the benefit lines
  // beyond the first, the trading name and the notes are not.
  const optional = id === 'commercialName' || id === 'benefit2' || id === 'benefit3' || id === 'benefitNotes'
  const shared = {
    id: `tj-${id}`,
    name: id,
    value,
    readOnly: locked,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `tj-${id}-error` : hint ? `tj-${id}-hint` : undefined,
    className: `tj-input${error ? ' tj-input-error' : ''}${locked ? ' tj-input-locked' : ''}`,
    required: !optional,
  }
  return (
    <div className="tj-field">
      <label htmlFor={`tj-${id}`} className="tj-label">
        {numbered ? <span className="tj-number">{numbered}</span> : null}
        {REGISTRATION_LABELS[id]}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(e) => onChange(id, e.target.value)} />
      ) : (
        <input {...shared} type={type} onChange={(e) => onChange(id, e.target.value)} {...rest} />
      )}
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
