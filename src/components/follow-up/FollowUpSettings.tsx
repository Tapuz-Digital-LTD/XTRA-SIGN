'use client'

import { useEffect, useState } from 'react'
import type { TaskDef } from '@/server/follow-up/labels'

/**
 * "משימות המשך": the list of tasks a signature opens, in the campaign's own
 * words — הקמת מוצר באתר, שליחת נראות לספק, as many as the work has. A row is
 * one task: name it, move it, remove it when it is not work any more. The
 * order here is the order they are opened in, and the order every screen
 * lists them in.
 *
 * A task carries a key a person never sees, minted here and kept for ever,
 * so renaming "הקמת מוצר באתר" tomorrow renames the rows on the board instead
 * of opening a second task beside them.
 *
 * With tasks on, an admin can also create them for the people who signed
 * before — a count first, then a confirmation, nothing written in between.
 */

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5'
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

type Notice = { tone: 'ok' | 'error'; text: string } | null

/** Short, stable, and never typed by a person. */
const newKey = () => `t_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
const same = (a: TaskDef[], b: TaskDef[]) => JSON.stringify(a) === JSON.stringify(b)

export function FollowUpSettings({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [tasks, setTasks] = useState<TaskDef[] | null>(null)
  const [saved, setSaved] = useState<TaskDef[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Notice>(null)
  const [preview, setPreview] = useState<{ candidates: number; skipped: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/projects/${projectId}/tasks`, { signal: controller.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { config?: { afterSign?: TaskDef[] } }) : null))
      .then((data) => {
        const list = data?.config?.afterSign ?? []
        setTasks(list)
        setSaved(list)
      })
      .catch(() => setTasks([]))
    return () => controller.abort()
  }, [projectId])

  const rename = (key: string, label: string) => setTasks((list) => (list ?? []).map((t) => (t.key === key ? { ...t, label } : t)))
  /** Up or down one place; buttons, not dragging, so a keyboard and a phone can do it too. */
  const move = (from: number, to: number) =>
    setTasks((list) => {
      const next = [...(list ?? [])]
      if (to < 0 || to >= next.length) return next
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  const remove = (key: string) => setTasks((list) => (list ?? []).filter((t) => t.key !== key))
  const add = () => {
    setTasks((list) => [...(list ?? []), { key: newKey(), label: '' }])
    setMessage(null)
  }

  async function save() {
    if (!tasks) return
    if (tasks.some((t) => !t.label.trim())) {
      setMessage({ tone: 'error', text: 'יש לתת שם לכל משימה, או להסיר אותה.' })
      return
    }
    const afterSign = tasks.map((t) => ({ key: t.key, label: t.label.trim() }))
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/campaign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followUpConfig: { afterSign } }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setTasks(afterSign)
      setSaved(afterSign)
      setMessage({ tone: 'ok', text: 'ההגדרות נשמרו.' })
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  async function backfill(apply: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      })
      const data = (await response.json().catch(() => null)) as { candidates?: number; created?: number; skipped?: number; error?: { message?: string } } | null
      if (!response.ok || !data) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'הפעולה נכשלה.' })
        setPreview(null)
        return
      }
      if (!apply) {
        setPreview({ candidates: data.candidates ?? 0, skipped: data.skipped ?? 0 })
        return
      }
      setPreview(null)
      setMessage({ tone: 'ok', text: data.created ? `נוצרו ${data.created} משימות.` : 'לא נוצרו משימות חדשות — לכולם כבר יש.' })
    } catch {
      setMessage({ tone: 'error', text: 'הפעולה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  const dirty = tasks !== null && !same(tasks, saved)

  return (
    <section className={card} aria-labelledby="fu-title">
      <h2 id="fu-title" className="text-base font-semibold text-fg">משימות המשך</h2>
      <p className="mt-1 text-sm text-muted">כאן קובעים אילו משימות ייפתחו לצוות אוטומטית אחרי כל חתימה — למשל הקמת מוצר באתר, שליחת נראות לספק. אפשר להוסיף כמה שצריך.</p>
      {tasks === null ? (
        <p className="mt-3 text-sm text-muted">טוען…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {tasks.map((task, i) => (
            <div key={task.key} className="flex items-center gap-2">
              <span aria-hidden="true" className="w-5 shrink-0 text-center text-sm tabular-nums text-muted">
                {i + 1}
              </span>
              <label className="min-w-0 flex-1">
                <span className="sr-only">שם המשימה {i + 1}</span>
                <input
                  type="text"
                  value={task.label}
                  maxLength={60}
                  autoFocus={!task.label}
                  onChange={(e) => rename(task.key, e.target.value)}
                  placeholder="שם המשימה, למשל: שליחת נראות לספק"
                  className="min-h-12 w-full rounded-lg border border-line bg-bg px-4 text-base text-fg outline-none focus:border-brand"
                />
              </label>
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`העלאת ${task.label || 'המשימה'} למעלה`} className={`${button} px-3`}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === tasks.length - 1} aria-label={`הורדת ${task.label || 'המשימה'} למטה`} className={`${button} px-3`}>
                ↓
              </button>
              <button type="button" onClick={() => remove(task.key)} aria-label={`הסרת ${task.label || 'המשימה'}`} className={button}>
                הסרה
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={add} disabled={tasks.length >= 12} className={button}>
              + הוספת משימה
            </button>
          </div>
          {tasks.length === 0 ? <p className="text-sm text-muted">אין משימות. אחרי חתימה לא ייפתח כלום.</p> : null}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">כל משימה נפתחת בנפרד אחרי כל חתימה, עם סטטוס משלה. שינוי שם משנה גם משימות שכבר נפתחו; משימה שמסירים מהרשימה לא נפתחת יותר, ומה שכבר נפתח נשאר.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={primary}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        {isAdmin && saved.length > 0 && !preview ? (
          <button type="button" disabled={busy || dirty} onClick={() => void backfill(false)} className={button} title={dirty ? 'שמרו קודם את ההגדרות' : undefined}>
            צור משימות למי שכבר חתם
          </button>
        ) : null}
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
            {message.text}
          </p>
        ) : null}
      </div>
      {preview ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-bg px-4 py-3 text-sm text-fg">
          <span>
            {preview.candidates === 0 ? 'לכל מי שחתם כבר יש את כל המשימות.' : `ייווצרו ${preview.candidates} משימות.`}
            {preview.skipped ? ` ${preview.skipped} הרשמות בדיקה ידולגו.` : ''}
          </span>
          {preview.candidates > 0 ? (
            <button type="button" disabled={busy} onClick={() => void backfill(true)} className={primary}>
              {busy ? 'יוצר…' : 'אישור'}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => setPreview(null)} className={button}>
            ביטול
          </button>
        </div>
      ) : null}
    </section>
  )
}
