'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Two steps and nothing else: a phone number, then the code that arrives.
 *
 * The number stays in this component's state rather than in the URL, so it does
 * not end up in browser history or in a referrer.
 */
export function LoginForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  // Only ever set when the server tells us no SMS actually left the building.
  const [devCode, setDevCode] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

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
      const { ok, data } = await post({ step: 'request', phone })
      if (!ok) {
        setError(data?.error?.message ?? 'שליחת הקוד נכשלה.')
        return
      }
      setSent(true)
      setNotice(data?.message ?? null)
      setMaskedPhone(data?.maskedPhone ?? null)
      setDevCode(data?.devCode ?? null)
      setCooldown(30)
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch {
      setError('שליחת הקוד נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post({ step: 'verify', phone, code })
      if (!ok) {
        setError(data?.error?.message ?? 'הכניסה נכשלה.')
        setCode('')
        return
      }
      // A full navigation, not a client transition: the session cookie was just
      // set, and every page above this one is rendered on the server.
      router.replace('/documents')
      router.refresh()
    } catch {
      setError('הכניסה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  if (!sent) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void request()
        }}
        className="mt-8 flex flex-col gap-4"
      >
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
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-start text-sm"
          />
          <p className="text-xs text-muted">נשלח אליכם קוד חד-פעמי בהודעת SMS.</p>
        </div>

        {error ? (
          // role="alert" so a screen reader announces it — a red border alone is
          // invisible to anyone not looking at the field.
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || phone.trim().length < 9}
          className="mt-2 min-h-11 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {busy ? 'שולח…' : 'שליחת קוד'}
        </button>
      </form>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void verify()
      }}
      className="mt-8 flex flex-col"
    >
      <p className="text-sm text-muted">
        {notice ?? 'נשלח קוד בן 6 ספרות.'}
        {maskedPhone ? (
          <>
            {' '}
            <span dir="ltr" className="font-medium text-fg">
              {maskedPhone}
            </span>
          </>
        ) : null}
      </p>

      <label htmlFor="code" className="sr-only">
        קוד כניסה
      </label>
      <input
        ref={codeRef}
        id="code"
        // Numeric keypad on a phone, and the OS offers the SMS code directly.
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="mt-5 min-h-14 w-full rounded-lg border border-line bg-surface text-center text-2xl tracking-[0.4em]"
      />

      {devCode ? (
        // Unmissable, and it says what actually happened: no SMS left the
        // server. Disappears the moment real credentials are configured.
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-start text-xs text-amber-900"
        >
          <strong>מצב פיתוח — לא נשלחה הודעת SMS.</strong>
          <br />
          הקוד לבדיקה: <span dir="ltr" className="font-mono text-sm">{devCode}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="mt-5 min-h-11 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {busy ? 'בודק…' : 'כניסה'}
      </button>

      <button
        type="button"
        onClick={() => void request()}
        disabled={busy || cooldown > 0}
        className="mt-3 min-h-11 text-sm text-muted disabled:opacity-60"
      >
        {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown}` : 'שליחה חוזרת'}
      </button>

      <button
        type="button"
        onClick={() => {
          setSent(false)
          setCode('')
          setError(null)
          setDevCode(null)
        }}
        className="mt-1 min-h-11 text-sm text-muted"
      >
        שינוי מספר הטלפון
      </button>
    </form>
  )
}
