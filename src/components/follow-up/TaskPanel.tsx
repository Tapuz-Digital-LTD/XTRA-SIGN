'use client'

import { useEffect, useState } from 'react'
import { TASK_STATUSES, type TaskStatus, type TaskSummary } from '@/server/follow-up/labels'

/**
 * The whole task, for a drawer: where it stands as four big cards, who
 * handles it, by when, a note, and the product's address once it exists.
 * One save button; the words are the team's, not the system's.
 */

const input = 'mt-1 min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

type Member = { id: string; name: string; email: string }

export function TaskPanel({ projectId, task, onSaved }: { projectId: string; task: TaskSummary; onSaved: (task: TaskSummary) => void }) {
  const [status, setStatus] = useState<TaskStatus>((task.status in TASK_STATUSES ? task.status : 'pending') as TaskStatus)
  const [assignee, setAssignee] = useState(task.assigneeUserId ?? '')
  const [dueAt, setDueAt] = useState(task.dueAt ? task.dueAt.slice(0, 10) : '')
  const [note, setNote] = useState(task.note ?? '')
  const [link, setLink] = useState(task.link ?? '')
  const [team, setTeam] = useState<Member[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/team', { signal: controller.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { users?: Member[] }) : null))
      .then((data) => setTeam(data?.users ?? []))
      .catch(() => setTeam([]))
    return () => controller.abort()
  }, [])

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, assigneeUserId: assignee || null, dueAt: dueAt || null, note: note || null, link: link || null }),
      })
      const data = (await response.json().catch(() => null)) as { task?: TaskSummary; error?: { message?: string } } | null
      if (!response.ok || !data?.task) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setLink(data.task.link ?? '')
      setMessage({ tone: 'ok', text: 'נשמר.' })
      onSaved({ ...task, ...data.task })
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">כאן מעדכנים איפה ההקמה עומדת, מי מטפל ועד מתי.</p>
      <fieldset>
        <legend className="text-sm text-muted">מצב ההקמה</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(Object.keys(TASK_STATUSES) as TaskStatus[]).map((key) => (
            <label key={key} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-3 text-center text-sm font-medium transition ${status === key ? 'border-brand bg-brand text-white' : 'border-line bg-bg text-fg hover:border-brand'}`}>
              <input type="radio" name="task-status" value={key} checked={status === key} onChange={() => setStatus(key)} className="sr-only" />
              {TASK_STATUSES[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="text-muted">מי מטפל</span>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={input}>
          <option value="">לא נבחר</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted">עד מתי</span>
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        <span className="text-muted">הערה</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">קישור למוצר באתר</span>
        <input type="url" inputMode="url" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()} className={primary}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}
