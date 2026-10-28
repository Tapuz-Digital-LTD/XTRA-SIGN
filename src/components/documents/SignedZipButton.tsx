'use client'

import { useState } from 'react'
import { zipStore } from '@/lib/zip'

/** Files fetched at once: enough to keep the line busy, few enough not to crowd the app. */
const PARALLEL = 4

/**
 * "הורדת N הסכמים חתומים (ZIP)", beside the Excel export of the agreements tab.
 *
 * The server hands back the list (and records the download); the browser
 * fetches each signed file through the route that authorizes it, and builds
 * the ZIP itself. A campaign's PDFs are tens of megabytes — more than one
 * function response may carry — and this way none of them sit in a function.
 * One file that cannot be fetched stops the whole ZIP: a folder that looks
 * complete and is not is worse than an error.
 */
export function SignedZipButton({ projectId, filter, call, count, zipName }: { projectId: string; filter?: string; call?: string; count: number; zipName: string }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setError(null)
    setProgress({ done: 0, total: count })
    try {
      const response = await fetch(`/api/projects/${projectId}/agreements/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, call }),
      })
      const data = (await response.json().catch(() => null)) as { files?: { id: string; fileName: string }[]; error?: { message?: string } } | null
      if (!response.ok || !data?.files) throw new Error(data?.error?.message ?? 'ההורדה נכשלה. נסו שוב.')
      const files = data.files
      if (files.length === 0) throw new Error('אין כאן הסכמים חתומים להורדה.')

      const out: { name: string; bytes: Uint8Array }[] = new Array(files.length)
      let next = 0
      let done = 0
      const worker = async () => {
        while (next < files.length) {
          const i = next++
          const file = await fetch(`/api/documents/${files[i].id}/file`)
          if (!file.ok) throw new Error(`לא הצלחנו להוריד את "${files[i].fileName}". נסו שוב.`)
          out[i] = { name: files[i].fileName, bytes: new Uint8Array(await file.arrayBuffer()) }
          setProgress({ done: ++done, total: files.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker))

      const url = URL.createObjectURL(zipStore(out))
      const link = document.createElement('a')
      link.href = url
      link.download = zipName
      link.click()
      // Revoked a moment later: some browsers start reading the blob only after click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ההורדה נכשלה. נסו שוב.')
    } finally {
      setProgress(null)
    }
  }

  const label = count === 1 ? 'הורדת ההסכם החתום (ZIP)' : `הורדת ${count} הסכמים חתומים (ZIP)`
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={progress !== null}
        aria-live="polite"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand disabled:opacity-60"
      >
        {progress ? `מוריד ${progress.done} מתוך ${progress.total}…` : label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </span>
  )
}
