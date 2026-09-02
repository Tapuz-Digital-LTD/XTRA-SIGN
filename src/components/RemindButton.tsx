'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * A staff-initiated reminder. Resends the signing link on whichever channels
 * the signer has, and says plainly what happened — the link the signer holds
 * is refreshed, so the newest message is the one that works.
 */
export function RemindButton({
  documentId,
  hasPhone,
  hasEmail,
}: {
  documentId: string
  hasPhone: boolean
  hasEmail: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const channels = [hasPhone ? 'sms' : null, hasEmail ? 'email' : null].filter(Boolean) as string[]
  if (channels.length === 0) return null

  async function remind() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${documentId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'שליחת התזכורת נכשלה.')
        return
      }
      setDone(true)
      router.refresh()
      // Let the confirmation sit briefly, then return to the normal label.
      setTimeout(() => setDone(false), 4000)
    } catch {
      setError('שליחת התזכורת נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  const label = channels.includes('sms') && channels.includes('email') ? 'SMS ואימייל' : channels.includes('sms') ? 'SMS' : 'אימייל'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remind}
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? 'שולח…' : done ? '✓ התזכורת נשלחה' : 'שליחת תזכורת'}
      </button>
      {!done && !busy ? (
        <span className="text-xs text-muted">תישלח שוב דרך {label}</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}
