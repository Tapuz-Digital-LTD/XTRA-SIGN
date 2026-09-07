'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { BulkAction, Tag } from '@/server/tags/tags'

export type BulkRow = {
  id: string
  name: string
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  tags: Tag[]
}

const TITLES: Record<BulkAction, string> = { add_tags: 'הוספת תגים', remove_tags: 'הסרת תגים', notes: 'הוספת הערה' }

const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/** A CSV cell: quoted, with inner quotes doubled. */
const cell = (value: string | null | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`

/** Excel opens a UTF-8 CSV correctly only when it starts with a byte-order mark. */
function downloadCsv(rows: BulkRow[]) {
  const header = ['שם', 'ח.פ / ע.מ', 'איש קשר', 'טלפון', 'אימייל', 'תגים']
  const lines = rows.map((r) => [r.name, r.taxId, r.contactName, r.contactPhone, r.contactEmail, r.tags.map((t) => t.name).join(' | ')].map(cell).join(','))
  const blob = new Blob([`﻿${[header.map(cell).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'xtra-sign-export.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function presentTags(rows: BulkRow[]): Tag[] {
  const present = new Map<string, Tag>()
  for (const row of rows) for (const tag of row.tags) present.set(tag.id, tag)
  return [...present.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'))
}

async function post(body: Record<string, unknown>) {
  const response = await fetch('/api/companies/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message ?? 'הפעולה נכשלה.')
  return data as { eligible: number; updated: number; skipped: number }
}

/**
 * The sticky bar over a selection: what is selected, and what can be done to
 * all of it at once. Each action opens one small dialog that says how many
 * records it will touch before anything is written.
 */
export function BulkBar({
  companyIds,
  rows,
  onDone,
  onClear,
  children,
}: {
  /** Everything selected, including rows a search has since hidden. */
  companyIds: string[]
  /** The selected rows as shown on screen — what the export contains. */
  rows: BulkRow[]
  /** After a change was written: refresh and clear the selection. */
  onDone: () => void
  onClear: () => void
  /** More actions the screen offers over a selection. */
  children?: ReactNode
}) {
  const [dialog, setDialog] = useState<BulkAction | null>(null)
  const button = 'inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg transition hover:border-brand'

  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-blue-50 px-3 py-2">
      <span className="text-sm font-semibold text-fg">נבחרו {companyIds.length}</span>
      <button type="button" onClick={() => setDialog('add_tags')} className={button}>הוספת תגים</button>
      <button type="button" onClick={() => setDialog('remove_tags')} className={button}>הסרת תגים</button>
      <button type="button" onClick={() => setDialog('notes')} className={button}>הערה</button>
      <button type="button" onClick={() => downloadCsv(rows)} className={button}>ייצוא</button>
      {children}
      <button type="button" onClick={onClear} className="ms-auto inline-flex min-h-11 items-center px-2 text-sm text-brand underline-offset-4 hover:underline">
        ביטול
      </button>
      {dialog ? <BulkDialog action={dialog} companyIds={companyIds} rows={rows} onClose={() => setDialog(null)} onDone={onDone} /> : null}
    </div>
  )
}

function BulkDialog({ action, companyIds, rows, onClose, onDone }: { action: BulkAction; companyIds: string[]; rows: BulkRow[]; onClose: () => void; onDone: () => void }) {
  const [eligible, setEligible] = useState<number | null>(null)
  // Removing offers only what the selection actually carries: nothing to take off that is not there.
  const [tags, setTags] = useState<Tag[]>(() => (action === 'remove_tags' ? presentTags(rows) : []))
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [newTag, setNewTag] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const preview = await post({ companyIds, action, preview: true, tagIds: [], notes: '' })
        if (!cancelled) setEligible(preview.eligible)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
      }
    })()
    if (action === 'add_tags') {
      void (async () => {
        const response = await fetch('/api/tags?kind=company')
        if (response.ok && !cancelled) setTags((await response.json())?.tags ?? [])
      })()
    }
    return () => {
      cancelled = true
    }
    // The dialog is mounted per action and per selection; its inputs do not change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function createTag() {
    const name = newTag.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: 'company' }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error?.message ?? 'יצירת התג נכשלה.')
      const tag: Tag = data.tag
      setTags((current) => (current.some((t) => t.id === tag.id) ? current : [...current, tag]))
      setChosen((current) => new Set(current).add(tag.id))
      setNewTag('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'יצירת התג נכשלה.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const done = await post({ companyIds, action, tagIds: [...chosen], notes: note })
      setResult(`עודכנו ${done.updated} · ללא שינוי ${done.skipped}`)
      onDone()
      setTimeout(onClose, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
    } finally {
      setBusy(false)
    }
  }

  const ready = action === 'notes' ? note.trim() !== '' : chosen.size > 0
  const exists = tags.some((t) => keyOf(t.name) === keyOf(newTag))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="bulk-title">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 id="bulk-title" className="text-base font-semibold text-fg">{TITLES[action]}</h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {action === 'notes' ? (
            <>
              <label htmlFor="bulk-note" className="text-sm text-fg">ההערה תתווסף כשורה חדשה להערות של כל רשומה. מה שכתוב כבר נשאר.</label>
              <textarea id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-lg border border-line bg-surface p-3 text-sm" placeholder="למשל: נשלח תזכורת בטלפון" />
            </>
          ) : tags.length === 0 && action === 'remove_tags' ? (
            <p className="text-sm text-muted">לרשומות שנבחרו אין תגים.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="בחירת תגים">
              {tags.map((tag) => {
                const on = chosen.has(tag.id)
                return (
                  <button key={tag.id} type="button" aria-pressed={on} onClick={() => toggle(tag.id)} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm transition-colors ${on ? 'bg-brand text-white' : 'bg-bg text-fg hover:bg-slate-200'}`}>
                    {on ? <span aria-hidden="true" className="me-1">✓</span> : null}
                    <span className="max-w-48 truncate">{tag.name}</span>
                  </button>
                )
              })}
              {tags.length === 0 ? <p className="text-sm text-muted">אין תגים עדיין — צרו את הראשון למטה.</p> : null}
            </div>
          )}

          {action === 'add_tags' ? (
            <div className="flex gap-2">
              <label htmlFor="bulk-new-tag" className="sr-only">תג חדש</label>
              <input
                id="bulk-new-tag"
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createTag()
                  }
                }}
                placeholder="תג חדש…"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
              />
              <button type="button" onClick={() => void createTag()} disabled={busy || !newTag.trim() || exists} className="min-h-11 shrink-0 rounded-lg border border-line bg-white px-3 text-sm text-fg disabled:opacity-50">
                צור תג חדש
              </button>
            </div>
          ) : null}

          <p className="text-sm text-muted" role="status">
            {eligible === null ? 'בודק…' : `הפעולה תחול על ${eligible} רשומות`}
          </p>
          {result ? <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{result}</p> : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="flex gap-2 border-t border-line p-4">
          <button type="button" onClick={() => void confirm()} disabled={busy || !ready || eligible === null || eligible === 0 || result !== null} className="min-h-11 flex-1 rounded-lg bg-brand text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50">
            {busy ? 'מבצע…' : 'אישור'}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-line bg-white text-sm text-fg hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
