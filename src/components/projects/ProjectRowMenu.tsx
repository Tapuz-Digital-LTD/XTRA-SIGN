'use client'

import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/** The row's quiet corner: archive in, archive out. Nothing here deletes. */
export function ProjectRowMenu({ projectId, archived }: { projectId: string; archived: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function toggleArchive() {
    setBusy(true)
    try {
      await fetch(`/api/groups/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: archived ? 'unarchive' : 'archive' }),
      })
      setOpen(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="פעולות נוספות"
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute end-0 top-10 z-30 w-44 rounded-lg border border-line bg-surface py-1 shadow-lg">
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleArchive()}
            className="flex min-h-10 w-full items-center px-3 text-start text-sm text-fg transition hover:bg-bg disabled:opacity-50"
          >
            {busy ? 'רגע…' : archived ? 'החזר לפעילים' : 'העבר לארכיון'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
