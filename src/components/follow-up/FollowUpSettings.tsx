'use client'

import { useEffect, useState } from 'react'
import { TASK_KINDS, type TaskKind } from '@/server/follow-up/labels'

/**
 * "משימות המשך": which task a signature creates, one big checkbox per kind.
 * With tasks on, an admin can also create them for the people who signed
 * before — a count first, then a confirmation, nothing written in between.
 */

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5'
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

type Notice = { tone: 'ok' | 'error'; text: string } | null

export function FollowUpSettings({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [afterSign, setAfterSign] = useState<TaskKind[] | null>(null)
  const [saved, setSaved] = useState<TaskKind[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Notice>(null)
  const [preview, setPreview] = useState<{ candidates: number; skipped: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/projects/${projectId}/tasks`, { signal: controller.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { config?: { afterSign?: TaskKind[] } }) : null))
      .then((data) => {
        const list = data?.config?.afterSign ?? []
        setAfterSign(list)
        setSaved(list)
      })
      .catch(() => setAfterSign([]))
    return () => controller.abort()
  }, [projectId])

  function toggle(kind: TaskKind, on: boolean) {
    setAfterSign((list) => {
      const next = (list ?? []).filter((k) => k !== kind)
      return on ? [...next, kind] : next
    })
  }

  async function save() {
    if (!afterSign) return
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

  const dirty = afterSign !== null && (afterSign.length !== saved.length || afterSign.some((k) => !saved.includes(k)))

  return (
    <section className={card} aria-labelledby="fu-title">
      <h2 id="fu-title" className="text-base font-semibold text-fg">משימות המשך</h2>
      <p className="mt-1 text-sm text-muted">כאן קובעים אילו משימות ייפתחו לצוות אוטומטית אחרי כל חתימה.</p>
      {afterSign === null ? (
        <p className="mt-3 text-sm text-muted">טוען…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {(Object.keys(TASK_KINDS) as TaskKind[]).map((kind) => (
            <label key={kind} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line bg-bg px-4 text-base text-fg has-[:checked]:border-brand">
              <input type="checkbox" className="size-5" checked={afterSign.includes(kind)} onChange={(e) => toggle(kind, e.target.checked)} />
              {TASK_KINDS[kind].label}
            </label>
          ))}
        </div>
      )}
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
            {preview.candidates === 0 ? 'לכל מי שחתם כבר יש משימה.' : `ייווצרו ${preview.candidates} משימות.`}
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
