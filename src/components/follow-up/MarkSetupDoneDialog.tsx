'use client'

import { useEffect, useRef, useState } from 'react'
import { taskWords, type TaskSummary } from '@/server/follow-up/labels'

/**
 * The one question a worker answers once a task is done — a link if there is
 * one, anything worth noting — and one save. It changes the task alone; the
 * agreement stays signed, and the dialog says so.
 */
const field = 'mt-1 min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-fg outline-none focus:border-brand'

export function MarkSetupDoneDialog({
  projectId,
  task,
  name,
  title,
  onClose,
  onDone,
}: {
  projectId: string
  task: { id: string; kind?: string | null; link: string | null; note: string | null }
  /** Whose work it is, under the title. */
  name?: string
  /** The task's own name, when the row does not already say it. */
  title?: string
  onClose: () => void
  onDone: (task: TaskSummary) => void
}) {
  const words = taskWords(task.kind)
  const [link, setLink] = useState(task.link ?? '')
  const [note, setNote] = useState(task.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    first.current?.focus()
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  async function save() {
    setBusy(true)
    setError(null)
    // Only what was typed travels: an empty field leaves the task's own value alone.
    const body: Record<string, string> = { status: 'done' }
    if (link.trim()) body.link = link.trim()
    if (note.trim()) body.note = note.trim()
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await response.json().catch(() => null)) as { task?: TaskSummary; error?: { message?: string } } | null
      if (!response.ok || !data?.task) {
        setError(data?.error?.message ?? 'לא הצלחנו לשמור. נסו שוב.')
        return
      }
      onDone(data.task)
    } catch {
      setError('לא הצלחנו לשמור. בדקו את החיבור לאינטרנט ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onClose}>
      {/* noValidate: "www.site.co.il/x" is fine — the server adds https:// — and a browser's URL nag would only confuse. */}
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-done-title"
        noValidate
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="mark-done-title" className="text-lg font-bold text-fg">
          {words.markDone}
        </h2>
        {name || title ? <p className="mt-1 text-sm text-muted">{[name, title].filter(Boolean).join(' · ')}</p> : null}
        <label className="mt-4 block text-sm">
          <span className="text-muted">{words.link} (לא חובה)</span>
          <input ref={first} type="url" inputMode="url" dir="ltr" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} className={field} />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-muted">הערה (לא חובה)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-base text-fg outline-none focus:border-brand" />
        </label>
        <p className="mt-3 text-sm text-fg">המשימה תסומן כ״{words.done}״. סטטוס החתימה לא משתנה.</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-base font-medium text-fg transition hover:border-brand">
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
