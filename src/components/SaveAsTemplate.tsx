'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * "Save as template", on the document page.
 *
 * One name, one button. The document's PDF and its current field layout are
 * copied into a template; the document itself is untouched.
 */
export function SaveAsTemplate({ documentId, defaultName }: { documentId: string; defaultName: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreementId: documentId, name }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השמירה נכשלה.')
        return
      }
      setSaved(true)
    } catch {
      setError('השמירה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <p role="status" className="text-sm text-muted">
        נשמר כתבנית.{' '}
        <Link href="/templates" className="text-fg underline underline-offset-4">
          לתבניות
        </Link>
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
      >
        שמירה כתבנית
      </button>
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          aria-label="שם התבנית"
          placeholder="שם התבנית"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg"
        >
          ביטול
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}
