'use client'

import { statusLabel, taskWords, type TaskSummary } from '@/server/follow-up/labels'

/**
 * How a finished task, and a task's state, are drawn wherever they appear.
 *
 * A table row is a supplier and gets one action for all its tasks (RowTasks);
 * a card or a drawer names each task on its own line (TaskLine); a closed
 * task is a statement with its link (SetupDoneMark). Never a button that
 * looks like a badge, never a badge that is secretly a button.
 */
/**
 * Where one task stands, in one line: a filled mark when it is closed, an
 * empty ring while it is not, the task's own name, and its state in its own
 * words. Used wherever several tasks of the same supplier sit together, so
 * finishing one never reads as finishing the rest.
 */
export function TaskLine({ task, className = '' }: { task: Pick<TaskSummary, 'kind' | 'title' | 'status'>; className?: string }) {
  const done = task.status === 'done'
  const closed = done || task.status === 'not_needed'
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span aria-hidden="true" className={`text-sm font-bold ${done ? 'text-green-700' : 'text-muted'}`}>
        {done ? '✓' : closed ? '—' : '○'}
      </span>
      <span className="min-w-0">
        <span className={`font-semibold ${closed && !done ? 'text-muted' : 'text-fg'}`}>{task.title}</span>
        <span className="text-muted"> — {statusLabel(task.status, task.kind)}</span>
      </span>
    </span>
  )
}

/** "✓ הוקם באתר", "✓ בוצע" — a statement, not a control. */
export function SetupDoneMark({ kind, link, className = '' }: { kind?: string | null; link?: string | null; className?: string }) {
  const words = taskWords(kind)
  return (
    <span data-setup-done className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-green-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 10.5 4 4 8-9" />
        </svg>
        {words.done}
      </span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-sm text-brand underline underline-offset-4">
          {words.openLink}
        </a>
      ) : null}
    </span>
  )
}
