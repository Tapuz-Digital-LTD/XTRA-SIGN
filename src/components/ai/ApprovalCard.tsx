'use client'

import { useState } from 'react'

/**
 * The card that stands between the assistant and anything irreversible.
 *
 * Approval lives here rather than in the conversation: typing "כן" is not
 * consent to a specific act. Each press sends the action's id and the hash of
 * exactly the arguments shown, so this button can only ever authorise what is
 * written on it.
 */
export function ApprovalCard({
  actionId,
  payloadHash,
  label,
  approvalsRequired,
  screen,
  onResolved,
}: {
  actionId: string
  payloadHash: string
  label: string
  approvalsRequired: number
  screen: Record<string, unknown>
  onResolved: (summary: string) => void
}) {
  const [confirmations, setConfirmations] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState<'done' | 'declined' | null>(null)

  const remaining = approvalsRequired - confirmations

  async function act(decline: boolean) {
    if (!decline && remaining > 1) {
      // The first press on a critical action only arms the second.
      setConfirmations((count) => count + 1)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, payloadHash, decline, screen }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה לא הושלמה.')
        return
      }
      if (decline) {
        setSettled('declined')
        onResolved('הפעולה בוטלה.')
      } else {
        setSettled('done')
        onResolved(data?.summary ?? 'הפעולה בוצעה.')
      }
    } catch {
      setError('הפעולה לא הושלמה. בדקו את החיבור ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (settled) {
    return (
      <p className={`mt-2 text-sm ${settled === 'done' ? 'text-green-800' : 'text-muted'}`}>
        {settled === 'done' ? '✓ בוצע' : 'בוטל'}
      </p>
    )
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-fg">{label}</p>
      {remaining > 1 ? (
        <p className="mt-1 text-xs text-amber-900">פעולה רגישה — נדרשים שני אישורים.</p>
      ) : confirmations > 0 ? (
        <p className="mt-1 text-xs font-medium text-amber-900">
          אישור אחרון: הפעולה תתבצע בפועל מיד לאחר הלחיצה.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(false)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'מבצע…' : remaining > 1 ? 'המשך' : 'אישור וביצוע'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(true)}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-fg transition hover:border-red-400 disabled:opacity-50"
        >
          ביטול
        </button>
      </div>

      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
