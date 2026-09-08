'use client'

import { useState } from 'react'
import { TASK_STATUSES, type TaskSummary } from '@/server/follow-up/labels'
import { MarkSetupDoneDialog } from './MarkSetupDoneDialog'

/**
 * The site-product task on a row. While it is open: one real button,
 * "סמן כהוקם באתר", that opens the same dialog as everywhere else (link,
 * note, save). Once done: a plain green mark and the product's link. Never
 * a button that looks like a badge, never a badge that is secretly a button.
 */
export const isOpenTask = (status: string) => status === 'pending' || status === 'in_progress'

export const markDoneButton = 'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

/** "✓ הוקם באתר" — a statement, not a control. */
export function SetupDoneMark({ link, className = '' }: { link?: string | null; className?: string }) {
  return (
    <span data-setup-done className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-green-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 10.5 4 4 8-9" />
        </svg>
        הוקם באתר
      </span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-sm text-brand underline underline-offset-4">
          פתח את המוצר
        </a>
      ) : null}
    </span>
  )
}

export function TaskBadge({ projectId, task, name, onChange }: { projectId: string; task: TaskSummary; name?: string; onChange: (task: TaskSummary) => void }) {
  const [dialog, setDialog] = useState(false)
  if (task.status === 'done') return <SetupDoneMark link={task.link} />
  if (!isOpenTask(task.status)) {
    return (
      <span className="whitespace-nowrap rounded-full bg-line px-2 py-0.5 text-[11px] font-medium text-muted" title="הקמת מוצר באתר">
        {TASK_STATUSES[task.status as keyof typeof TASK_STATUSES] ?? task.status}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {task.status === 'in_progress' ? <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">{TASK_STATUSES.in_progress}</span> : null}
      <button type="button" onClick={() => setDialog(true)} className={markDoneButton}>
        סמן כהוקם באתר
      </button>
      {dialog ? (
        <MarkSetupDoneDialog
          projectId={projectId}
          task={{ id: task.id, link: task.link, note: task.note }}
          name={name}
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
