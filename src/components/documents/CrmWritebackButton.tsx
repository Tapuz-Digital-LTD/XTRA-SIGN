'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Sends the signed PDF back to the Fireberry record it came from, and marks
 * that record as agreed.
 *
 * Shown once a document is signed and came from a CRM record. Nothing reaches
 * the CRM until this button is pressed — uploading is a decision the user
 * makes, never a side effect of a signature.
 */
export function CrmWritebackButton({
  documentId,
  state,
}: {
  documentId: string
  state: 'done' | 'failed' | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state === 'done') {
    return (
      <p className="text-sm text-green-800">✓ הועלה ל-Fireberry וסומן כהצעה שאושרה</p>
    )
  }

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${documentId}/writeback`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'ההעלאה נכשלה.')
        return
      }
      router.refresh()
    } catch {
      setError('ההעלאה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {state === 'failed' ? (
        <p className="text-xs text-red-700">ההעלאה ל-Fireberry נכשלה.</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void send()}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50"
      >
        {busy ? 'מעלה…' : state === 'failed' ? 'נסה שוב להעלות ל-Fireberry' : 'העלה ל-Fireberry'}
      </button>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
