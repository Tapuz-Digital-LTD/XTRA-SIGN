'use client'

import { useState } from 'react'
import { statusLabel, TASK_STATUSES, taskWords, type TaskSummary } from '@/server/follow-up/labels'

/**
 * A supplier's follow-up tasks on one table row.
 *
 * A row is a supplier, not a task, so it gets one action — "סמן משימות" —
 * and a dialog that asks the only question a worker has after a phone call:
 * what got done. The row itself answers the other question, at a glance and
 * without a click: which tasks are finished and which are still waiting.
 *
 *     ✓ הוקם באתר   ○ שליחת נראות לספק      [סמן משימות]
 *
 * A finished task is green, ticked and named — never colour alone. The row's
 * button is quiet on purpose: fifty rows of solid blue is a wall, and the
 * weight belongs on the save inside the dialog.
 */

const isOpen = (status: string) => status === 'pending' || status === 'in_progress'

/** A finished task in its own words: "הוקם באתר" where the kind has a word of its own, else its name. */
function doneLabel(task: Pick<TaskSummary, 'kind' | 'title'>): string {
  const { done } = taskWords(task.kind)
  return done === TASK_STATUSES.done ? task.title : done
}

const chipBase = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium'
const TONES: Record<string, string> = {
  done: 'border-green-200 bg-green-50 text-green-800',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-800',
  pending: 'border-line bg-surface text-muted',
  not_needed: 'border-line bg-bg text-muted',
}

function Chip({ task }: { task: TaskSummary }) {
  const done = task.status === 'done'
  return (
    <span className={`${chipBase} ${TONES[task.status] ?? TONES.not_needed}`} title={`${task.title} — ${statusLabel(task.status, task.kind)}`}>
      <span aria-hidden="true">{done ? '✓' : task.status === 'not_needed' ? '—' : task.status === 'in_progress' ? '●' : '○'}</span>
      {done ? doneLabel(task) : task.title}
      <span className="sr-only"> — {statusLabel(task.status, task.kind)}</span>
    </span>
  )
}

/** What the row shows: the finished tasks first, then what is still waiting. */
export function TaskChips({ tasks, max = 3 }: { tasks: TaskSummary[]; max?: number }) {
  if (tasks.length === 0) return null
  const order = [...tasks].sort((a, b) => Number(isOpen(a.status)) - Number(isOpen(b.status)))
  const shown = order.slice(0, max)
  const rest = order.length - shown.length
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((task) => (
        <Chip key={task.id} task={task} />
      ))}
      {rest > 0 ? <span className="text-[11px] text-muted">ועוד {rest}</span> : null}
    </span>
  )
}

const secondary = 'inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-fg transition hover:border-brand disabled:opacity-50'

export function RowTasks({ projectId, tasks, name, onChange, className = '' }: { projectId: string; tasks: TaskSummary[]; name?: string; onChange: (task: TaskSummary) => void; className?: string }) {
  const [dialog, setDialog] = useState(false)
  if (tasks.length === 0) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} onClick={(e) => e.stopPropagation()}>
      <TaskChips tasks={tasks} />
      {tasks.some((t) => isOpen(t.status)) ? (
        <button type="button" onClick={() => setDialog(true)} className={secondary}>
          סמן משימות
        </button>
      ) : null}
      {dialog ? <MarkTasksDialog projectId={projectId} tasks={tasks} name={name} onClose={() => setDialog(false)} onSaved={onChange} /> : null}
    </span>
  )
}

/**
 * "מה כבר בוצע?" — every task of this supplier, ticked or not, and one save.
 *
 * A task that is being ticked now offers the one field worth asking for at
 * that moment (the product's address, for the task that has one); nothing is
 * asked for a task that is only being unticked. Only what changed is sent.
 */
function MarkTasksDialog({
  projectId,
  tasks,
  name,
  onClose,
  onSaved,
}: {
  projectId: string
  tasks: TaskSummary[]
  name?: string
  onClose: () => void
  onSaved: (task: TaskSummary) => void
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(tasks.map((t) => [t.id, t.status === 'done'])))
  const [links, setLinks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = tasks.filter((t) => checked[t.id] !== (t.status === 'done'))

  async function save() {
    if (changed.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const task of changed) {
        const done = checked[task.id]
        const body: Record<string, string> = { status: done ? 'done' : 'pending' }
        const link = links[task.id]?.trim()
        if (done && link) body.link = link
        const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = (await response.json().catch(() => null)) as { task?: TaskSummary; error?: { message?: string } } | null
        if (!response.ok || !data?.task) {
          setError(data?.error?.message ?? 'לא הצלחנו לשמור. נסו שוב.')
          return
        }
        onSaved({ ...task, ...data.task })
      }
      onClose()
    } catch {
      setError('לא הצלחנו לשמור. בדקו את החיבור לאינטרנט ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-tasks-title"
        noValidate
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="mark-tasks-title" className="text-lg font-bold text-fg">
          סימון משימות
        </h2>
        {name ? <p className="mt-1 text-sm text-muted">{name}</p> : null}
        <p className="mt-1 text-sm text-muted">סמנו מה כבר בוצע. כל משימה נשמרת בנפרד.</p>

        <ul className="mt-4 flex flex-col divide-y divide-line">
          {tasks.map((task) => {
            const on = checked[task.id]
            const words = taskWords(task.kind)
            return (
              <li key={task.id} className="py-1">
                <label className="flex min-h-12 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[color:var(--brand,#2563eb)]"
                    checked={on}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [task.id]: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base ${on ? 'font-semibold text-fg' : 'text-fg'}`}>{task.title}</span>
                    <span className="block text-xs text-muted">{statusLabel(task.status, task.kind)}</span>
                  </span>
                </label>
                {on && task.status !== 'done' ? (
                  <label className="mb-2 block ps-8 text-sm">
                    <span className="text-muted">{words.link} (לא חובה)</span>
                    <input
                      type="url"
                      inputMode="url"
                      dir="ltr"
                      placeholder="https://"
                      value={links[task.id] ?? task.link ?? ''}
                      onChange={(e) => setLinks((prev) => ({ ...prev, [task.id]: e.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-fg outline-none focus:border-brand"
                    />
                  </label>
                ) : null}
              </li>
            )
          })}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'שומר…' : changed.length > 0 ? `שמירה (${changed.length})` : 'שמירה'}
          </button>
          <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-base font-medium text-fg transition hover:border-brand">
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
