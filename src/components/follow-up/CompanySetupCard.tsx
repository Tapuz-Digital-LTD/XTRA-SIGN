'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { TASK_STATUSES, type TaskSummary } from '@/server/follow-up/labels'
import { MarkSetupDoneDialog } from './MarkSetupDoneDialog'
import { SetupDoneMark } from './TaskBadge'
import { TaskPanel } from './TaskPanel'

/**
 * On a company's card: is their product up on the site yet. One line that
 * says where it stands and who has it, "סמן כהוקם" while it is open, and the
 * whole task under "פרטי המשימה" for whoever needs more than that.
 */
export type CompanySetupTask = {
  id: string
  status: string
  assigneeUserId: string | null
  assigneeName: string | null
  dueAt: string | null
  link: string | null
  note: string | null
}

const dayFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50'

export function CompanySetupCard({ projectId, task: served }: { projectId: string; task: CompanySetupTask }) {
  const router = useRouter()
  // What this person changed since the last refresh, over what the server sent.
  const [patch, setPatch] = useState<Partial<CompanySetupTask>>({})
  const [dialog, setDialog] = useState(false)
  const [details, setDetails] = useState(false)
  const task = { ...served, ...patch }
  const open = task.status === 'pending' || task.status === 'in_progress'
  const summary: TaskSummary = { id: task.id, kind: 'site_product', status: task.status, assigneeUserId: task.assigneeUserId, dueAt: task.dueAt, note: task.note, link: task.link }

  const saved = (t: TaskSummary) => {
    setPatch((prev) => ({ ...prev, status: t.status, assigneeUserId: t.assigneeUserId, dueAt: t.dueAt, note: t.note, link: t.link }))
    router.refresh()
  }

  return (
    <section data-setup-card aria-labelledby="setup-card-title" className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="setup-card-title" className="text-base font-semibold text-fg">
            הקמת מוצר באתר
          </h2>
          {task.status === 'done' ? (
            <SetupDoneMark link={task.link} className="mt-1" />
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              {TASK_STATUSES[task.status as keyof typeof TASK_STATUSES] ?? task.status} · אחראי: {task.assigneeName ?? 'לא נבחר'}
              {task.dueAt ? ` · עד ${dayFormat.format(new Date(task.dueAt))}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {open ? (
            <button type="button" onClick={() => setDialog(true)} className={`${button} bg-brand text-white hover:opacity-90`}>
              סמן כהוקם באתר
            </button>
          ) : null}
          <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className={`${button} border border-line bg-surface text-fg hover:border-brand`}>
            פרטי המשימה
          </button>
        </div>
      </div>
      {details ? (
        <div className="mt-4 border-t border-line pt-4">
          <TaskPanel projectId={projectId} task={summary} onSaved={saved} />
        </div>
      ) : null}
      {dialog ? (
        <MarkSetupDoneDialog
          projectId={projectId}
          task={task}
          onClose={() => setDialog(false)}
          onDone={(t) => {
            setDialog(false)
            saved(t)
          }}
        />
      ) : null}
    </section>
  )
}
