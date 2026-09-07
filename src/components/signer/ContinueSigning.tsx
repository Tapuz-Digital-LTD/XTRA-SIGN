'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * The one screen a signer sees when the permission behind their link ran
 * out and this browser has not proved the phone yet: one button that renews
 * the link and moves on to the code. Never "expired", never "start again".
 */
export function ContinueSigning({ token, maskedPhone, title, signed }: { token: string; maskedPhone: string | null; title: string; signed: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/sign/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו להמשיך. נסו שוב בעוד רגע.')
        return
      }
      router.replace(data.path)
    } catch {
      setError('לא הצלחנו להמשיך. בדקו את החיבור לאינטרנט ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        <p className="text-sm font-bold tracking-tight text-fg">
          XTRA <span className="text-brand">SIGN</span>
        </p>
        <h1 className="mt-6 text-xl font-bold text-fg">{signed ? 'המסמך כבר נחתם' : 'ממשיכים לחתימה'}</h1>
        <p className="mt-2 text-base text-fg">
          {signed
            ? 'קבלו קוד לטלפון כדי להוריד את העותק החתום.'
            : `קבלו קוד לטלפון${maskedPhone ? ` ${maskedPhone}` : ''} כדי להמשיך מהמקום שבו עצרתם. שום דבר לא אבד.`}
        </p>
        {title ? <p className="mt-3 text-sm text-muted">{title}</p> : null}
        <button type="button" onClick={() => void go()} disabled={busy} className="mt-8 min-h-14 w-full rounded-lg bg-brand text-base font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60">
          {busy ? 'רגע…' : signed ? 'שלחו לי קוד להורדה' : 'שלחו לי קוד והמשיכו'}
        </button>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
