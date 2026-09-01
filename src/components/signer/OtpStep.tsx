'use client'

import { useEffect, useRef, useState } from 'react'

/** Phone verification. One code, one input, one button. */
export function OtpStep({
  token,
  maskedPhone,
  onVerified,
}: {
  token: string
  maskedPhone: string | null
  onVerified: () => void
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  // Only ever set when the server tells us no SMS was actually sent.
  const [devCode, setDevCode] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function request() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/sign/${token}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send' }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'שליחת הקוד נכשלה.')
        return
      }
      setSent(true)
      setDevCode(data?.devCode ?? null)
      setCooldown(30)
      setTimeout(() => inputRef.current?.focus(), 50)
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
      const response = await fetch(`/api/sign/${token}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'האימות נכשל.')
        setCode('')
        return
      }
      onVerified()
    } catch {
      setError('האימות נכשל. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  if (!sent) {
    return (
      <>
        <h1 className="text-lg font-semibold text-fg">אימות זהות</h1>
        <p className="mt-2 text-sm text-muted">
          נשלח קוד אימות חד-פעמי למספר{' '}
          <span dir="ltr" className="font-medium text-fg">
            {maskedPhone ?? ''}
          </span>
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={request}
          disabled={busy}
          className="mt-6 min-h-12 w-full rounded-lg bg-brand text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'שולח…' : 'שליחת קוד'}
        </button>
      </>
    )
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-fg">הזינו את הקוד</h1>
      <p className="mt-2 text-sm text-muted">
        שלחנו קוד בן 6 ספרות אל{' '}
        <span dir="ltr" className="font-medium text-fg">
          {maskedPhone ?? ''}
        </span>
      </p>

      <label htmlFor="otp" className="sr-only">
        קוד אימות
      </label>
      <input
        ref={inputRef}
        id="otp"
        // Numeric keypad on a phone, and the OS offers the SMS code directly.
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="mt-5 min-h-14 w-full rounded-lg border border-line bg-white text-center text-2xl tracking-[0.4em]"
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
        type="button"
        onClick={verify}
        disabled={busy || code.length !== 6}
        className="mt-5 min-h-12 w-full rounded-lg bg-brand text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'בודק…' : 'אישור'}
      </button>

      <button
        type="button"
        onClick={request}
        disabled={busy || cooldown > 0}
        className="mt-3 min-h-11 w-full text-sm text-muted disabled:opacity-60"
      >
        {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown}` : 'שליחה חוזרת'}
      </button>
    </>
  )
}
