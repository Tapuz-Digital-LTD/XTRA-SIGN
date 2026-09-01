'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

export function UploadCard() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)

    const body = new FormData()
    body.append('file', file)

    try {
      const response = await fetch('/api/documents/upload', { method: 'POST', body })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        // The server's Hebrew message, never the raw status line.
        setError(data?.error?.message ?? 'ההעלאה נכשלה. נסו שוב.')
        return
      }

      router.push(`/documents/${data.agreementId}`)
    } catch {
      setError('ההעלאה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <h2 className="text-base font-semibold text-fg">העלאת מסמך</h2>
      <p className="mt-1 text-sm text-muted">העלאת Word או PDF קיים</p>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-4 min-h-11 w-full rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {busy ? 'מעלה…' : 'בחירת קובץ'}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
