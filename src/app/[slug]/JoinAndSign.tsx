'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SignaturePad } from '@/components/signer/SignaturePad'
import {
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
 * The agreement, as a form: every clause beside the control that answers it,
 * in the document's own words and order, in four short steps —
 *
 *   1  פרטי בית העסק     who is joining
 *   2  פרטי ההטבה        what they give, and how a customer redeems it
 *   3  תקופת ההתחייבות   which regional week, and the optional extension
 *   4  אישור וחתימה      what they filled in, the terms, the declarations,
 *                        the signatory, the signature — then "חתום ושלח"
 *
 * Pressing it registers the business (supplier, project, agreement and
 * signing link are created behind the scenes) and the page turns into the
 * phone verification; a correct code completes the signature with the
 * drawing held in memory, through XTRA Sign's ordinary engine.
 *
 * A step is checked when it is left, on the same rules the server applies,
 * and only its own fields are named — nothing typed is ever cleared. What
 * has been typed also survives a reload: the draft lives in sessionStorage,
 * which dies with the tab, because these are a business's details and there
 * is no server-side draft to keep them in.
 *
 * `resume` is the same page reached from the SMS or the email after the
 * browser was closed: details locked by the server, straight to step 4.
 */

const FORM_VERSION = '2026-09-09.1'
/** The engine's consent wording — the same sentence the standard signer shows. */
const CONSENT_TEXT = 'אני מאשר/ת שקראתי את המסמך ושחתימתי ניתנת על ידי מרצוני.'

/** The four steps, and which of the agreement's answers each one asks for. */
const STEPS = [
  { key: 'business', title: 'פרטי בית העסק', fields: ['businessName', 'taxId', 'commercialName', 'email', 'contactPerson', 'phone'] },
  { key: 'benefit', title: 'פרטי ההטבה', fields: ['benefit1', 'benefit2', 'benefit3', 'benefitNotes', 'redemption', 'couponCode'] },
  { key: 'week', title: 'תקופת ההתחייבות', fields: ['week', 'optionalExtension'] },
  { key: 'sign', title: 'אישור וחתימה', fields: ['declareLicense', 'declareInsurance', 'signatoryName', 'signatoryRole'] },
] as const satisfies readonly { key: string; title: string; fields: readonly RegistrationField[] }[]
const LAST = STEPS.length - 1

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
  contactPerson: '',
  phone: '',
  email: '',
  // The agreement's minimum, already written; the business adds to it or replaces it.
  benefit1: '25% הנחה',
  benefit2: '',
  benefit3: '',
  benefitNotes: '',
  week: '',
  // The campaign's own code needs nothing typed; a business with its own switches.
  redemption: 'generic_xtra25',
  couponCode: '',
  // Starts ticked (the owner's call, 2026-09-09): a business that does not want the extension unticks it.
  optionalExtension: true,
  // Drawn ticked on the printed page; still required, so unticking blocks the signature.
  declareLicense: true,
  declareInsurance: true,
})

function errorMessage(data: unknown, fallback: string): string {
  const message = (data as { error?: { message?: string } } | null)?.error?.message
  return typeof message === 'string' && message ? message : fallback
}

/** The draft a tab keeps while the form is open. */
type Draft = { values: FormValues; stage: number; version: string }

function draftKey(formId: string) {
  return `xs-join:${formId}`
}

function readDraft(formId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(formId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (parsed.version !== FORM_VERSION || !parsed.values || typeof parsed.stage !== 'number') return null
    return { values: { ...emptyValues(), ...parsed.values }, stage: Math.min(Math.max(parsed.stage, 0), LAST), version: FORM_VERSION }
  } catch {
    return null
  }
}

function writeDraft(formId: string, draft: Omit<Draft, 'version'> | null) {
  try {
    if (draft) sessionStorage.setItem(draftKey(formId), JSON.stringify({ ...draft, version: FORM_VERSION }))
    else sessionStorage.removeItem(draftKey(formId))
  } catch {
    // Storage blocked: the form still works for as long as the page lives.
  }
}

export function JoinAndSign({ mode, slug, formId, projectName, captcha, token: initialToken, values: locked, verified = false, maskedPhone: initialMasked }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<FormValues>(() => (locked ? { ...locked } : emptyValues()))
  const [stage, setStage] = useState<number>(() => (locked ? LAST : 0))
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
  const stepRef = useRef<HTMLDivElement>(null)
  const { getToken } = useCaptcha(captcha)

  // A draft is read once the page is on the client: reading it while the
  // server's markup is still being matched would make the two disagree. The
  // one-tick delay keeps this from being a synchronous state change inside
  // the effect, which React flags.
  useEffect(() => {
    if (mode !== 'new') return
    const saved = readDraft(formId)
    if (!saved) return
    const id = setTimeout(() => {
      setValues(saved.values)
      setStage(saved.stage)
    }, 0)
    return () => clearTimeout(id)
  }, [mode, formId])

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
    setValues((v) => {
      const next = { ...v, [field]: value }
      if (mode === 'new') writeDraft(formId, { values: next, stage })
      return next
    })
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const ORDER: readonly RegistrationField[] = STEPS.flatMap((step) => step.fields)

  function focusFirstError(fields: Partial<Record<RegistrationField, string>>) {
    const first = ORDER.find((f) => fields[f])
    if (!first) return
    const el = document.getElementById(`tj-${first}`)
    el?.focus()
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /** Move to a step and bring its top into view — the heading, not the field. */
  function goTo(next: number) {
    let current = values
    if (next === LAST && mode === 'new' && !values.signatoryName.trim() && values.contactPerson.trim()) {
      current = { ...values, signatoryName: values.contactPerson }
      setValues(current)
    }
    setStage(next)
    setMessage(null)
    if (mode === 'new') writeDraft(formId, { values: current, stage: next })
    requestAnimationFrame(() => stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  /** "המשך": this step's own answers, on the server's rules; nothing typed is touched. */
  function next() {
    const checked = validateRegistration(values)
    const own = STEPS[stage].fields as readonly RegistrationField[]
    const here: Partial<Record<RegistrationField, string>> = {}
    if (!checked.ok) for (const f of own) if (checked.fields[f]) here[f] = checked.fields[f]
    if (Object.keys(here).length > 0) {
      setErrors((e) => ({ ...e, ...here }))
      focusFirstError(here)
      return
    }
    goTo(Math.min(stage + 1, LAST))
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
        writeDraft(formId, null)
        setMaskedContact(data.maskedContact ?? '')
        setStep('already')
        return
      }

      writeDraft(formId, null)
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

  const current = STEPS[stage]
  const onLast = stage === LAST

  return (
    <div className="tj-flow">
      <section className="tj-intro">
        <h1 className="tj-h1">הצטרפות ל{projectName}</h1>
        <p className="tj-lead">
          {lockedMode
            ? 'הפרטים נשמרו בהרשמה. נשארו החתימה והקוד שנשלח לנייד.'
            : 'ארבעה שלבים קצרים: פרטי בית העסק, ההטבה, שבוע התיירות, ואישור וחתימה. אפשר לחזור ולתקן בכל שלב. כל השדות חובה, אלא אם צוין אחרת.'}
        </p>
      </section>

      <nav className="tj-steps" aria-label="שלבי ההרשמה">
        <p className="tj-steps-now">
          שלב {stage + 1} מתוך {STEPS.length} · {current.title}
        </p>
        <ol className="tj-steps-rail">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={`tj-steps-seg${i < stage ? ' tj-steps-done' : ''}${i === stage ? ' tj-steps-current' : ''}`}
              aria-current={i === stage ? 'step' : undefined}
            >
              <span className="tj-sr">{s.title}</span>
            </li>
          ))}
        </ol>
      </nav>

      <form
        className="tj-form"
        data-form-id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          if (step !== 'form') return
          if (onLast) void submit()
          else next()
        }}
        noValidate
      >
        <div ref={stepRef} className="tj-step-anchor" />

        {stage === 0 ? (
          <section className="tj-card" aria-labelledby="tj-business-heading">
            <h2 id="tj-business-heading" className="tj-h2">פרטי בית העסק</h2>
            <div className="tj-fields">
              <Field id="businessName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="organization" />
              <Field id="taxId" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} inputMode="numeric" dir="ltr" autoComplete="off" placeholder="לדוגמה 515123456" />
              <Field id="commercialName" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} hint="אם העסק פועל תחת שם אחר מזה של החברה. לא חובה." />
              <Field id="email" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="email" inputMode="email" dir="ltr" autoComplete="email" />
              <Field id="contactPerson" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="name" />
              <Field id="phone" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} type="tel" inputMode="tel" dir="ltr" autoComplete="tel" placeholder="050-1234567" hint="אליו יישלח קוד האימות לחתימה." />
            </div>
            <p className="tj-clause">
              בית העסק מביע בזאת את רצונו להצטרף כבית עסק משתתף במסגרת פרויקט &quot;חודש התיירות הישראלית&quot; שיתקיים בחודש נובמבר 2026
            </p>
          </section>
        ) : null}

        {stage === 1 ? (
          <section className="tj-card" aria-labelledby="tj-benefit-heading">
            <h2 id="tj-benefit-heading" className="tj-h2">פרטי ההטבה</h2>
            <p className="tj-clause tj-clause-lead">
              בית העסק יעניק הטבה בלעדית של 25% הנחה ומעלה מהאתר המקוון של בית העסק עבור לקוחות שיגיעו דרך הפרסום באתר המיזם.
            </p>
            <p className="tj-legend">
              סוג ההטבה: (מ־<span dir="ltr">25%</span> הנחה ומעלה)
            </p>
            <div className="tj-fields">
              <Field id="benefit1" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="1." />
              <Field id="benefit2" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="2." />
              <Field id="benefit3" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} numbered="3." />
              <Field id="benefitNotes" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} multiline />
            </div>

            <fieldset className="tj-group" id="tj-redemption" tabIndex={-1} disabled={frozen} aria-describedby={errors.redemption ? 'tj-redemption-error' : undefined}>
              <legend className="tj-legend tj-legend-strong">קוד קופון / מימוש - נא לסמן את הבחירה</legend>
              <div className="tj-choices">
                <label className={`tj-choice${values.redemption === 'generic_xtra25' ? ' tj-choice-on' : ''}`}>
                  <input type="radio" name="redemption" value="generic_xtra25" checked={values.redemption === 'generic_xtra25'} onChange={() => setField('redemption', 'generic_xtra25')} />
                  <span className="tj-choice-body">
                    <span className="tj-choice-title">קוד גנרי</span>
                    <span className="tj-coupon">XTRA25</span>
                  </span>
                </label>
                <label className={`tj-choice${values.redemption === 'business_pos_code' ? ' tj-choice-on' : ''}`}>
                  <input type="radio" name="redemption" value="business_pos_code" checked={values.redemption === 'business_pos_code'} onChange={() => setField('redemption', 'business_pos_code')} />
                  <span className="tj-choice-body">
                    <span className="tj-choice-title">קוד קופון על פי קופת בית העסק</span>
                  </span>
                </label>
              </div>
              {values.redemption === 'business_pos_code' ? (
                <div className="tj-choice-detail">
                  <Field id="couponCode" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} dir="ltr" autoComplete="off" />
                </div>
              ) : null}
              {errors.redemption ? (
                <p id="tj-redemption-error" role="alert" className="tj-error">
                  {errors.redemption}
                </p>
              ) : null}
            </fieldset>
          </section>
        ) : null}

        {stage === 2 ? (
          <section className="tj-card" aria-labelledby="tj-week-heading">
            <h2 id="tj-week-heading" className="tj-h2">תקופת ההתחייבות</h2>
            <p className="tj-clause tj-clause-lead">
              ההטבה הנ״ל מחייבת במהלך שבוע התיירות האזורי שבו משתתף בית העסק, בפרט מיום רביעי ועד מוצ״ש באותו השבוע.
            </p>
            <fieldset className="tj-group" id="tj-week" tabIndex={-1} disabled={frozen} aria-describedby={errors.week ? 'tj-week-error' : undefined}>
              <legend className="tj-legend tj-legend-strong">תאריכי ההטבה ע״פ אזורי חלוקה - נובמבר 2026</legend>
              <div className="tj-weeks">
                {TOURISM_WEEKS.map((week) => (
                  <label key={week.id} className={`tj-week${values.week === week.id ? ' tj-week-on' : ''}`}>
                    <input type="radio" name="week" value={week.id} checked={values.week === week.id} onChange={() => setField('week', week.id)} />
                    <span className="tj-week-body">
                      <span className="tj-week-title">{week.title}</span>
                      <span className="tj-week-dates" dir="ltr">
                        {week.dates}
                      </span>
                      <span className="tj-week-regions">{week.regions}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.week ? (
                <p id="tj-week-error" role="alert" className="tj-error">
                  {errors.week}
                </p>
              ) : null}
            </fieldset>
            <label className="tj-consent">
              <input type="checkbox" checked={values.optionalExtension} onChange={(e) => setField('optionalExtension', e.target.checked)} disabled={frozen} />
              <span>
                הרחבה אופציונלית: במידה ובית העסק יבחר בכך (על פי שיקול דעתו הבלעדי), יורשה להעניק את ההטבה לכלל פעילות שאר האזורים בארץ לאורך כל
                חודש התיירות הישראלית (11.2026).
              </span>
            </label>
          </section>
        ) : null}

        {stage === LAST ? (
          <>
            {!lockedMode ? <Summary values={values} onEdit={goTo} /> : null}

            <section className="tj-card" aria-labelledby="tj-terms-heading">
              <h2 id="tj-terms-heading" className="tj-h2">תנאים והגבלות למימוש ההטבה</h2>
              <AgreementTerms />
            </section>

            <section className="tj-card" role="group" aria-labelledby="tj-declarations-heading">
              <h2 id="tj-declarations-heading" className="tj-h2">הצהרות ואישורים</h2>
              <label className="tj-consent tj-consent-first">
                <input id="tj-declareLicense" type="checkbox" checked={values.declareLicense} onChange={(e) => setField('declareLicense', e.target.checked)} disabled={frozen} aria-describedby={errors.declareLicense ? 'tj-declareLicense-error' : undefined} />
                <span>הנני מצהיר/ה כי ברשות בית העסק רישיון עסק תקף כחוק.</span>
              </label>
              {errors.declareLicense ? (
                <p id="tj-declareLicense-error" role="alert" className="tj-error">
                  {errors.declareLicense}
                </p>
              ) : null}
              <label className="tj-consent">
                <input id="tj-declareInsurance" type="checkbox" checked={values.declareInsurance} onChange={(e) => setField('declareInsurance', e.target.checked)} disabled={frozen} aria-describedby={errors.declareInsurance ? 'tj-declareInsurance-error' : undefined} />
                <span>הנני מצהיר/ה כי ברשות בית העסק פוליסת ביטוח בתוקף.</span>
              </label>
              {errors.declareInsurance ? (
                <p id="tj-declareInsurance-error" role="alert" className="tj-error">
                  {errors.declareInsurance}
                </p>
              ) : null}
            </section>

            <section className="tj-card" aria-labelledby="tj-signatory-heading">
              <h2 id="tj-signatory-heading" className="tj-h2">חתימת בית העסק</h2>
              <div className="tj-fields">
                <Field
                  id="signatoryName"
                  values={values}
                  errors={errors}
                  onChange={setField}
                  locked={lockedMode}
                  disabled={frozen}
                  autoComplete="name"
                  hint={!lockedMode && values.signatoryName && values.signatoryName === values.contactPerson ? 'מולא לפי איש הקשר. אם חותם/ת מישהו אחר, אפשר לשנות.' : undefined}
                />
                <Field id="signatoryRole" values={values} errors={errors} onChange={setField} locked={lockedMode} disabled={frozen} autoComplete="organization-title" placeholder="לדוגמה: בעלים, מנכ״ל" />
              </div>
              {lockedMode ? <p className="tj-hint tj-hint-block">הפרטים נשמרו בהרשמה. לשינוי פרטים יש להירשם מחדש מעמוד הקול הקורא.</p> : null}
            </section>

            <section className="tj-card" ref={signatureRef} aria-labelledby="tj-signature-heading">
              <h2 id="tj-signature-heading" className="tj-h2">חתימה</h2>
              <p className="tj-hint tj-hint-lead">חתימת מורשה/ת החתימה. התאריך יתמלא אוטומטית ביום החתימה.</p>
              <SignaturePad onChange={setSignature} className={step === 'form' ? '' : 'tj-locked'} />
              <label className="tj-consent">
                <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} disabled={frozen} />
                <span>{CONSENT_TEXT}</span>
              </label>
              <AgreementSystemNote />
            </section>
          </>
        ) : null}

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
          <div className="tj-actions tj-actions-steps">
            {stage > 0 && !lockedMode ? (
              <button type="button" className="tj-back" onClick={() => goTo(stage - 1)} disabled={busy}>
                חזרה
              </button>
            ) : null}
            <button type="submit" className={`tj-primary${onLast ? ' tj-primary-main' : ''}`} disabled={busy}>
              {busy ? 'שולח…' : onLast ? (lockedMode ? 'חתימה' : 'חתום ושלח') : 'המשך'}
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


/**
 * What was filled in, before it is signed — each step's answers under its
 * own title, with the way back to change any of them. Choices are shown by
 * the words the form used, so nothing here has to be decoded.
 */
/**
 * "25%" inside a Hebrew sentence: the percent sign is direction-neutral and
 * can end up drawn on the wrong side of its digits. A left-to-right mark on
 * each side of the number keeps it whole, wherever the sentence puts it.
 */
function keepNumbers(text: string): string {
  return text.replace(/(\d[\d.,]*%)/g, '\u200e$1\u200e')
}

function Summary({ values, onEdit }: { values: FormValues; onEdit: (stage: number) => void }) {
  const week = TOURISM_WEEKS.find((w) => w.id === values.week)
  const redemption =
    values.redemption === 'generic_xtra25' ? 'קוד גנרי XTRA25' : values.redemption === 'business_pos_code' ? `קוד קופון על פי קופת בית העסק · ${values.couponCode || '—'}` : '—'
  const benefits = [values.benefit1, values.benefit2, values.benefit3].filter(Boolean)
  const rows: { stage: number; title: string; items: [string, string][] }[] = [
    {
      stage: 0,
      title: STEPS[0].title,
      items: [
        [REGISTRATION_LABELS.businessName, values.businessName || '—'],
        [REGISTRATION_LABELS.taxId, values.taxId || '—'],
        ...(values.commercialName ? ([[REGISTRATION_LABELS.commercialName, values.commercialName]] as [string, string][]) : []),
        [REGISTRATION_LABELS.email, values.email || '—'],
        [REGISTRATION_LABELS.contactPerson, values.contactPerson || '—'],
        [REGISTRATION_LABELS.phone, values.phone || '—'],
      ],
    },
    {
      stage: 1,
      title: STEPS[1].title,
      items: [
        ['סוג ההטבה', benefits.length ? benefits.map((b, i) => `${i + 1}. ${b}`).join(' · ') : '—'],
        ...(values.benefitNotes ? ([[REGISTRATION_LABELS.benefitNotes, values.benefitNotes]] as [string, string][]) : []),
        [REGISTRATION_LABELS.redemption, redemption],
      ],
    },
    {
      stage: 2,
      title: STEPS[2].title,
      items: [
        [REGISTRATION_LABELS.week, week ? `${week.title} · ${week.dates}` : '—'],
        [REGISTRATION_LABELS.optionalExtension, values.optionalExtension ? 'כן' : 'לא'],
      ],
    },
  ]
  return (
    <section className="tj-summary" aria-labelledby="tj-summary-heading">
      <h2 id="tj-summary-heading" className="tj-summary-heading">
        מה שמילאתם
      </h2>
      {rows.map((group) => (
        <div key={group.stage} className="tj-summary-group">
          <div className="tj-summary-head">
            <h3>{group.title}</h3>
            <button type="button" className="tj-summary-edit" onClick={() => onEdit(group.stage)}>
              עריכה
            </button>
          </div>
          <dl className="tj-summary-list">
            {group.items.map(([label, value]) => (
              <div key={label} className="tj-summary-row">
                <dt>{label}</dt>
                <dd dir={/^[\d+@\w.\- ]+$/.test(value) ? 'ltr' : undefined}>{keepNumbers(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
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
        {optional ? <span className="tj-optional"> (לא חובה)</span> : null}
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
