'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Creates a document from a template for the already-chosen company. */
export function UseTemplateButton({
  templateId,
  companyId,
  label = 'שימוש בתבנית',
  highlighted = false,
}: {
  templateId: string
  companyId: string
  label?: string
  highlighted?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function use() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/templates/${templateId}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה מהתבנית נכשלה.')
        return
      }
      router.push(`/documents/${data.agreementId}/edit`)
    } catch {
      setError('היצירה מהתבנית נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-stretch">
      <button
        type="button"
        disabled={busy}
        onClick={use}
        className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition disabled:opacity-50 ${
          highlighted
            ? 'bg-brand text-white hover:opacity-90'
            : 'border border-line bg-surface text-fg hover:border-brand'
        }`}
      >
        {busy ? 'יוצר…' : label}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs text-red-800">{error}</span> : null}
    </span>
  )
}
