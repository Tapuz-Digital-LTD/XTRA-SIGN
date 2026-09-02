'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

export function UploadCard({ companyId }: { companyId?: string | null }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)

    try {
      // 1. Ask for a short-lived URL. The key is chosen server-side and carries
      //    the tenant prefix, so the browser never picks where its file lands.
      const presign = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'presign' }),
      })
      const presigned = await presign.json().catch(() => null)
      if (!presign.ok) {
        setError(presigned?.error?.message ?? 'ההעלאה נכשלה. נסו שוב.')
        return
      }

      // 2. Straight to storage. The file never passes through a function.
      const put = await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      })
      if (!put.ok) {
        setError('ההעלאה נכשלה. ייתכן שהקובץ גדול מדי.')
        return
      }

      // 3. Only now does the server look at the bytes. A file whose leading
      //    bytes are not a PDF is rejected here and deleted.
      const adopt = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'adopt',
          key: presigned.key,
          filename: file.name,
          ...(companyId ? { companyId } : {}),
        }),
      })
      const data = await adopt.json().catch(() => null)
      if (!adopt.ok) {
        setError(data?.error?.message ?? 'ההעלאה נכשלה. נסו שוב.')
        return
      }

      router.push(`/documents/${data.agreementId}`)
    } catch (cause) {
      // A rejected fetch carries no status and no body — a blocked request and
      // a dead network look identical to the user. Log the cause so the next
      // one is diagnosable from the console rather than guessed at.
      console.error('upload failed', cause)
      setError('ההעלאה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <h2 className="text-base font-semibold text-fg">העלאת מסמך</h2>
      <p className="mt-1 text-sm text-muted">העלאת קובץ PDF קיים</p>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
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
