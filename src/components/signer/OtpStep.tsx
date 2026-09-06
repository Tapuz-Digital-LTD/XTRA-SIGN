'use client'

import { useEffect, useState } from 'react'
import { OtpInput } from '@/components/ui/OtpInput'

/** Phone verification before signing: one code, the shared input, one button. */
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
      setCode('')
      setDevCode(data?.devCode ?? null)
      setCooldown(30)
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
      const response = await fetch(`/api/sign/${token}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code: supplied }),
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
      <div className="xtra-rise">
        <h1 className="text-lg font-semibold text-fg">אימות זהות</h1>
        <p className="mt-2 text-sm text-muted">
          נשלח קוד אימות חד-פעמי למספר{' '}
          <span dir="ltr" className="font-medium text-fg">
            {maskedPhone ?? ''}
          </span>
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={request}
          disabled={busy}
          className="mt-6 h-12 w-full rounded-xl bg-brand text-base font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'שולחים…' : 'שליחת קוד'}
        </button>
      </div>
    )
  }

  return (
    <form
      className="xtra-rise"
      onSubmit={(e) => {
        e.preventDefault()
        void verify()
      }}
      noValidate
    >
      <h1 className="text-lg font-semibold text-fg">הזינו את הקוד</h1>
      <p className="mt-2 text-sm text-muted">
        שלחנו קוד בן 6 ספרות אל{' '}
        <span dir="ltr" className="font-medium text-fg">
          {maskedPhone ?? ''}
        </span>
        . בטלפון, הקוד יוצע לכם מעל המקלדת.
      </p>

      <div className="mt-5">
        <OtpInput value={code} onChange={(next) => { setCode(next); if (error) setError(null) }} onComplete={(c) => void verify(c)} disabled={busy} invalid={Boolean(error)} id="otp" />
      </div>

      {devCode ? (
        // Unmissable, and it says what actually happened: no SMS left the
        // server. Disappears the moment real credentials are configured.
        <p role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-start text-xs text-amber-900">
          <strong>מצב פיתוח — לא נשלחה הודעת SMS.</strong>
          <br />
          הקוד לבדיקה: <span dir="ltr" className="font-mono text-sm">{devCode}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="mt-5 h-12 w-full rounded-xl bg-brand text-base font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'בודקים…' : 'אישור'}
      </button>

      <button
        type="button"
        onClick={request}
        disabled={busy || cooldown > 0}
        className="mt-3 min-h-11 w-full text-sm text-muted disabled:opacity-60"
      >
        {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown} שנ׳` : 'שלחו לי קוד מחדש'}
      </button>
    </form>
  )
}
