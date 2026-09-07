'use client'

import { useState } from 'react'
import { TASK_STATUSES, type TaskSummary } from '@/server/follow-up/labels'

/**
 * The task on a row: its status as a chip, and while it is still open, one
 * button that closes it. The chip changes first and comes back if the
 * server says no — a person marking twenty rows should not wait for each.
 */

const TONE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800',
  in_progress: 'bg-blue-50 text-blue-800',
  done: 'bg-green-50 text-green-800',
  not_needed: 'bg-line text-muted',
}

export function TaskBadge({
  projectId,
  task,
  onChange,
  onError,
}: {
  projectId: string
  task: TaskSummary
  onChange: (task: TaskSummary) => void
  onError?: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const open = task.status === 'pending' || task.status === 'in_progress'

  async function markDone() {
    const previous = task
    onChange({ ...task, status: 'done' })
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      const data = (await response.json().catch(() => null)) as { task?: TaskSummary; error?: { message?: string } } | null
      if (!response.ok || !data?.task) {
        onChange(previous)
        onError?.(data?.error?.message ?? 'לא הצלחנו לעדכן את המשימה.')
        return
      }
      onChange({ ...previous, ...data.task })
    } catch {
      onChange(previous)
      onError?.('לא הצלחנו לעדכן את המשימה.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[task.status] ?? TONE.not_needed}`} title="הקמת מוצר באתר">
        {TASK_STATUSES[task.status as keyof typeof TASK_STATUSES] ?? task.status}
      </span>
      {open ? (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            void markDone()
          }}
          className="inline-flex min-h-9 items-center rounded-lg border border-green-300 bg-green-50 px-2.5 text-xs font-semibold text-green-800 transition hover:border-green-500 disabled:opacity-50"
          aria-label="סמן שהמוצר הוקם באתר"
        >
          ✓ הוקם
        </button>
      ) : task.link ? (
        <a href={task.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand hover:underline">
          למוצר
        </a>
      ) : null}
    </span>
  )
}
