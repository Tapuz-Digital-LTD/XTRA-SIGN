'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Pushes the signed PDF straight onto the company's CRM record — no download,
 * no re-upload. Shown only when the CRM is configured and the company carries a
 * record id, so it is never a dead button.
 */
export function CrmUploadButton({ documentId }: { documentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${documentId}/crm-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'ההעלאה ל-CRM נכשלה.')
        return
      }
      setDone(true)
      router.refresh()
      setTimeout(() => setDone(false), 4000)
    } catch {
      setError('ההעלאה ל-CRM נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={upload}
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? 'מעלה…' : done ? '✓ הועלה ל-CRM' : 'העלה ל-CRM'}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}
