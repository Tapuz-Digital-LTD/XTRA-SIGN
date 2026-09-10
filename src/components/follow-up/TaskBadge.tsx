'use client'

import { useState } from 'react'
import { statusLabel, taskWords, type TaskSummary } from '@/server/follow-up/labels'
import { MarkSetupDoneDialog } from './MarkSetupDoneDialog'

/**
 * A follow-up task on a row. While it is open: one real button in the task's
 * own words ("סמן כהוקם באתר", "סמן כבוצע"), opening the same dialog as
 * everywhere else (link, note, save). Once done: a plain green mark and the
 * link, if there is one. Never a button that looks like a badge, never a
 * badge that is secretly a button.
 */
export const isOpenTask = (status: string) => status === 'pending' || status === 'in_progress'

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

export const markDoneButton = 'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

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

export function TaskBadge({ projectId, task, name, onChange }: { projectId: string; task: TaskSummary; name?: string; onChange: (task: TaskSummary) => void }) {
  const [dialog, setDialog] = useState(false)
  if (task.status === 'done') return <SetupDoneMark kind={task.kind} link={task.link} />
  if (!isOpenTask(task.status)) {
    return (
      <span className="whitespace-nowrap rounded-full bg-line px-2 py-0.5 text-[11px] font-medium text-muted" title={task.title}>
        {statusLabel(task.status, task.kind)}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {task.status === 'in_progress' ? <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">{statusLabel('in_progress', task.kind)}</span> : null}
      <button type="button" onClick={() => setDialog(true)} className={markDoneButton} title={task.title}>
        {taskWords(task.kind).markDone}
      </button>
      {dialog ? (
        <MarkSetupDoneDialog
          projectId={projectId}
          task={{ id: task.id, kind: task.kind, link: task.link, note: task.note }}
          name={name}
          title={task.title}
          onClose={() => setDialog(false)}
          onDone={(t) => {
            setDialog(false)
            onChange({ ...task, ...t })
          }}
        />
      ) : null}
    </span>
  )
}
