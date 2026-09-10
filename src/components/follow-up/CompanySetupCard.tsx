'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { TaskSummary } from '@/server/follow-up/labels'
import { taskWords } from '@/server/follow-up/labels'
import { MarkSetupDoneDialog } from './MarkSetupDoneDialog'
import { SetupDoneMark, TaskLine } from './TaskBadge'
import { TaskPanel } from './TaskPanel'

/**
 * On a company's card: every follow-up task the campaign opened for them,
 * one line each — a mark, the task's name, where it stands, who has it.
 * Each line carries its own button, because finishing one task says nothing
 * about the others.
 */
export type CompanySetupTask = {
  id: string
  projectId: string
  kind: string
  title: string
  status: string
  assigneeUserId: string | null
  assigneeName: string | null
  dueAt: string | null
  link: string | null
  note: string | null
}

const dayFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50'

export function CompanySetupCard({ tasks: served }: { tasks: CompanySetupTask[] }) {
  const router = useRouter()
  // What this person changed since the last refresh, over what the server sent.
  const [patched, setPatched] = useState<Record<string, Partial<CompanySetupTask>>>({})
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)

  const tasks = served.map((t) => ({ ...t, ...patched[t.id] }))
  const saved = (id: string, t: TaskSummary) => {
    setPatched((prev) => ({ ...prev, [id]: { ...prev[id], status: t.status, assigneeUserId: t.assigneeUserId, dueAt: t.dueAt, note: t.note, link: t.link } }))
    router.refresh()
  }

  if (tasks.length === 0) return null

  return (
    <section data-setup-card aria-labelledby="setup-card-title" className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 id="setup-card-title" className="text-base font-semibold text-fg">
        משימות המשך
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {tasks.map((task) => {
          const open = task.status === 'pending' || task.status === 'in_progress'
          const summary: TaskSummary = { id: task.id, kind: task.kind, title: task.title, status: task.status, assigneeUserId: task.assigneeUserId, dueAt: task.dueAt, note: task.note, link: task.link }
          return (
            <li key={task.id} className="py-3 first:pt-1 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <TaskLine task={task} className="text-sm" />
                  <p className="mt-0.5 text-xs text-muted">
                    אחראי: {task.assigneeName ?? 'לא נבחר'}
                    {task.dueAt ? ` · עד ${dayFormat.format(new Date(task.dueAt))}` : ''}
                  </p>
                  {task.status === 'done' && task.link ? <SetupDoneMark kind={task.kind} link={task.link} className="mt-1" /> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {open ? (
                    <button type="button" onClick={() => setDialogId(task.id)} className={`${button} bg-brand text-white hover:opacity-90`}>
                      {taskWords(task.kind).markDone}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-expanded={detailsId === task.id}
                    onClick={() => setDetailsId((id) => (id === task.id ? null : task.id))}
                    className={`${button} border border-line bg-surface text-fg hover:border-brand`}
                  >
                    פרטי המשימה
                  </button>
                </div>
              </div>
              {detailsId === task.id ? (
                <div className="mt-3 border-t border-line pt-3">
                  <TaskPanel projectId={task.projectId} task={summary} onSaved={(t) => saved(task.id, t)} />
                </div>
              ) : null}
              {dialogId === task.id ? (
                <MarkSetupDoneDialog
                  projectId={task.projectId}
                  task={task}
                  title={task.title}
                  onClose={() => setDialogId(null)}
                  onDone={(t) => {
                    setDialogId(null)
                    saved(task.id, t)
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
