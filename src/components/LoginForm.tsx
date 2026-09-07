'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useCaptcha } from '@/components/captcha/useCaptcha'
import { OtpInput } from '@/components/ui/OtpInput'
import { CAPTCHA_ACTIONS, type CaptchaPublicConfig } from '@/lib/captcha'

/**
 * Three moments: a phone number, the code that arrives, in.
 *
 * The number stays in this component's state rather than in the URL, so it
 * does not end up in browser history or in a referrer. The CAPTCHA token
 * is minted at the moment of asking for a code, when it is switched on.
 */
type Step = 'phone' | 'code' | 'done'

export function LoginForm({ captcha }: { captcha?: CaptchaPublicConfig | null }) {
  const { getToken } = useCaptcha(captcha)
  const router = useRouter()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  // Only ever set when the server tells us no SMS actually left the building.
  const [devCode, setDevCode] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function post(body: Record<string, string>) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null)
    return { ok: response.ok, data }
  }

  async function request() {
    setBusy(true)
    setError(null)
    try {
      const captchaToken = (await getToken(CAPTCHA_ACTIONS.LOGIN_OTP)) ?? ''
      const { ok, data } = await post({ step: 'request', phone, captchaToken })
      if (!ok) {
        setError(data?.error?.message ?? 'שליחת הקוד נכשלה.')
        return
      }
      setMaskedPhone(data?.maskedPhone ?? null)
      setDevCode(data?.devCode ?? null)
      setCooldown(30)
      setCode('')
      setStep('code')
    } catch {
      setError('שליחת הקוד נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(supplied = code) {
    if (supplied.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post({ step: 'verify', phone, code: supplied })
      if (!ok) {
        setError(data?.error?.message ?? 'הכניסה נכשלה.')
        setCode('')
        return
      }
      setStep('done')
      // A full navigation, not a client transition: the session cookie was
      // just set, and every page above this one is rendered on the server.
      setTimeout(() => {
        router.replace('/')
        router.refresh()
      }, 650)
    } catch {
      setError('הכניסה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  const phoneOk = phone.replace(/\D/g, '').length >= 9

  if (step === 'done') {
    return (
      <div className="xtra-rise flex flex-col items-center py-6 text-center" role="status" aria-live="polite">
        <span className="xtra-pop flex size-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700" aria-hidden="true">
          ✓
        </span>
        <p className="mt-4 text-lg font-semibold text-fg">נכנסתם בהצלחה</p>
        <p className="mt-1 text-sm text-muted">מעבירים אתכם למערכת…</p>
      </div>
    )
  }

  if (step === 'phone') {
    return (
      <form
        key="phone"
        onSubmit={(e) => {
          e.preventDefault()
          void request()
        }}
        className="xtra-rise flex flex-col gap-5"
        noValidate
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">כניסה למערכת</h1>
          <p className="mt-1 text-sm text-muted">מזינים את מספר הנייד, מקבלים קוד ב-SMS, ונכנסים.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium text-fg">
            מספר טלפון נייד
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            autoFocus
            autoComplete="tel"
            inputMode="tel"
            dir="ltr"
            placeholder="050-000-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'phone-error' : 'phone-hint'}
            disabled={busy}
            className="h-14 rounded-xl border-2 border-line bg-surface px-4 text-start text-lg tracking-wide text-fg outline-none transition-colors focus:border-brand disabled:opacity-60"
          />
          <p id="phone-hint" className="text-xs text-muted">המספר שאיתו נרשמתם למערכת.</p>
        </div>

        {error ? (
          // role="alert" so a screen reader announces it — a red border alone is
          // invisible to anyone not looking at the field.
          <p id="phone-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !phoneOk}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" />
              שולחים קוד…
            </span>
          ) : (
            'שליחת קוד'
          )}
        </button>
      </form>
    )
  }

  return (
    <form
      key="code"
      onSubmit={(e) => {
        e.preventDefault()
        void verify()
      }}
      className="xtra-rise flex flex-col gap-5"
      noValidate
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">הזינו את הקוד</h1>
        <p className="mt-1 text-sm text-muted">
          שלחנו קוד בן 6 ספרות אל{' '}
          <span dir="ltr" className="font-medium text-fg">
            {maskedPhone ?? 'הנייד שהוזן'}
          </span>
          . בטלפון, הקוד יוצע לכם מעל המקלדת.
        </p>
      </div>

      <OtpInput value={code} onChange={(next) => { setCode(next); if (error) setError(null) }} onComplete={(c) => void verify(c)} disabled={busy} invalid={Boolean(error)} id="code" label="קוד כניסה" />

      {devCode ? (
        // Unmissable, and it says what actually happened: no SMS left the
        // server. Disappears the moment real credentials are configured.
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-start text-xs text-amber-900">
          <strong>מצב פיתוח — לא נשלחה הודעת SMS.</strong>
          <br />
          הקוד לבדיקה: <span dir="ltr" className="font-mono text-sm">{devCode}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" />
            בודקים…
          </span>
        ) : (
          'כניסה'
        )}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => void request()} disabled={busy || cooldown > 0} className="min-h-11 text-muted underline-offset-4 hover:text-fg hover:underline disabled:no-underline disabled:opacity-60">
          {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown} שנ׳` : 'שלחו לי קוד מחדש'}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep('phone')
            setCode('')
            setError(null)
            setDevCode(null)
          }}
          className="min-h-11 text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          שינוי מספר הטלפון
        </button>
      </div>
    </form>
  )
}
