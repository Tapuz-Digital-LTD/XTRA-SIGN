'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { currentUrlFor, withReturnTo } from '@/lib/return-to'
import { TASK_STATUSES, type TaskSummary } from '@/server/follow-up/labels'
import { MarkSetupDoneDialog } from './MarkSetupDoneDialog'
import { TaskPanel } from './TaskPanel'

/**
 * "הקמת מוצרים באתר": every supplier who signed, and whether their product
 * is up on the site yet. A worker finds the supplier, presses "סמן כהוקם",
 * and is done — no task vocabulary. Nothing here touches the agreement: a
 * signature that is complete is not work that is complete.
 */
export type SetupStatus = 'all' | 'pending' | 'in_progress' | 'done' | 'not_needed'
export type SetupCounts = Record<Exclude<SetupStatus, 'all'>, number>
export type SetupRow = {
  taskId: string
  leadId: string | null
  companyId: string | null
  agreementId: string | null
  name: string
  contactName: string | null
  contactPhone: string | null
  signedAt: string | null
  status: string
  assigneeUserId: string | null
  assigneeName: string | null
  dueAt: string | null
  link: string | null
  note: string | null
}
type Member = { id: string; name: string }
type Notice = { tone: 'ok' | 'error'; text: string }
type BulkKind = 'assign' | 'in_progress' | 'due' | 'done'

const CHIPS: { key: SetupStatus; label: string }[] = [
  { key: 'pending', label: TASK_STATUSES.pending },
  { key: 'in_progress', label: TASK_STATUSES.in_progress },
  { key: 'done', label: TASK_STATUSES.done },
  { key: 'not_needed', label: TASK_STATUSES.not_needed },
  { key: 'all', label: 'הכול' },
]
const TONE: Record<string, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-900',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-900',
  done: 'border-green-200 bg-green-50 text-green-900',
  not_needed: 'border-line bg-bg text-muted',
}
const dayFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
const bigButton = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50'
const primary = `${bigButton} bg-brand text-white hover:opacity-90`
const secondary = `${bigButton} border border-line bg-surface text-fg hover:border-brand`
const field = 'min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-fg outline-none focus:border-brand'

const isOpen = (status: string) => status === 'pending' || status === 'in_progress'
const day = (iso: string | null) => (iso ? dayFormat.format(new Date(iso)) : '—')
/** "www.site.co.il/p/12": enough to recognise, short enough for a cell. */
const shortLink = (link: string) => {
  const bare = link.replace(/^https?:\/\//i, '')
  return bare.length > 32 ? `${bare.slice(0, 30)}…` : bare
}
const digits = (s: string) => s.replace(/\D/g, '')
const inSome = (n: number) => (n === 1 ? 'במשימה אחת' : `ב-${n} משימות`)

function matches(row: SetupRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (row.name.toLowerCase().includes(needle) || (row.contactName ?? '').toLowerCase().includes(needle)) return true
  const d = digits(needle)
  return d.length > 0 && digits(row.contactPhone ?? '').includes(d)
}

const toSummary = (row: SetupRow): TaskSummary => ({ id: row.taskId, kind: 'site_product', status: row.status, assigneeUserId: row.assigneeUserId, dueAt: row.dueAt, note: row.note, link: row.link })

function StatusChip({ status }: { status: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[status] ?? TONE.not_needed}`}>{TASK_STATUSES[status as keyof typeof TASK_STATUSES] ?? status}</span>
}

export function SetupTable({ projectId, rows: served, counts, status, team }: { projectId: string; rows: SetupRow[]; counts: SetupCounts; status: SetupStatus; team: Member[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const here = currentUrlFor(pathname, params)
  const [q, setQ] = useState('')
  // What this person changed since the last refresh, over what the server sent.
  const [patched, setPatched] = useState<Record<string, Partial<SetupRow> | undefined>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)
  const [bulk, setBulk] = useState<BulkKind | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const all = served.map((r) => ({ ...r, ...patched[r.taskId] }))
  const rows = all.filter((r) => matches(r, q))
  const byId = new Map(all.map((r) => [r.taskId, r]))
  const current = openId ? (byId.get(openId) ?? null) : null
  const marking = doneId ? (byId.get(doneId) ?? null) : null
  const total = counts.pending + counts.in_progress + counts.done + counts.not_needed
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.taskId))

  const patch = (ids: string[], change: Partial<SetupRow>) =>
    setPatched((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = { ...next[id], ...change }
      return next
    })
  const nameOf = (userId: string | null) => (userId ? (team.find((m) => m.id === userId)?.name ?? null) : null)
  const saved = (t: TaskSummary, text: string) => {
    patch([t.id], { status: t.status, assigneeUserId: t.assigneeUserId, assigneeName: nameOf(t.assigneeUserId), dueAt: t.dueAt, link: t.link, note: t.note })
    setNotice({ tone: 'ok', text })
    router.refresh()
  }
  const href = (key: SetupStatus) => {
    const next = new URLSearchParams(params.toString())
    next.set('tab', 'setup')
    if (key === 'all') next.delete('status')
    else next.set('status', key)
    return `${pathname}?${next}`
  }
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectVisible = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.taskId)) : new Set())

  async function runBulk(kind: BulkKind, value: string) {
    const ids = [...selected]
    const body: Record<string, unknown> = { taskIds: ids }
    const change: Partial<SetupRow> = {}
    if (kind === 'assign') {
      body.assigneeUserId = value || null
      change.assigneeUserId = value || null
      change.assigneeName = nameOf(value || null)
    } else if (kind === 'due') {
      body.dueAt = value || null
      change.dueAt = value ? `${value}T00:00:00+03:00` : null
    } else {
      body.status = kind
      change.status = kind
    }
    const before = Object.fromEntries(ids.map((id) => [id, patched[id]]))
    patch(ids, change)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await response.json().catch(() => null)) as { updated?: number; failed?: number; error?: { message?: string } } | null
      if (!response.ok) throw new Error(data?.error?.message ?? 'לא הצלחנו לעדכן. נסו שוב.')
      const updated = data?.updated ?? 0
      const failed = data?.failed ?? 0
      const worded =
        kind === 'done' ? (updated === 1 ? 'משימה אחת סומנה כהוקמה.' : `${updated} משימות סומנו כהוקמו.`)
        : kind === 'in_progress' ? (updated === 1 ? 'משימה אחת הועברה לבטיפול.' : `${updated} משימות הועברו לבטיפול.`)
        : kind === 'assign' ? `האחראי עודכן ${inSome(updated)}.`
        : `תאריך היעד נקבע ${inSome(updated)}.`
      setNotice(failed ? { tone: 'error', text: `${worded} ${failed === 1 ? 'משימה אחת לא עודכנה' : `${failed} משימות לא עודכנו`} — רעננו את המסך.` } : { tone: 'ok', text: worded })
      setSelected(new Set())
      setBulk(null)
      router.refresh()
    } catch (e) {
      setPatched((prev) => ({ ...prev, ...before }))
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'לא הצלחנו לעדכן. נסו שוב.' })
    }
  }

  const actions = (row: SetupRow, wide: boolean) => (
    <>
      {isOpen(row.status) ? (
        <button type="button" onClick={() => setDoneId(row.taskId)} className={primary}>
          סמן כהוקם
        </button>
      ) : null}
      <button type="button" onClick={() => setOpenId(row.taskId)} className={`${secondary} ${!wide && !isOpen(row.status) ? 'col-span-2' : ''}`}>
        פרטי המשימה
      </button>
    </>
  )

  return (
    <section data-setup-table className={`flex flex-col gap-4 ${selected.size > 0 ? 'pb-40 md:pb-0' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="סינון לפי סטטוס הקמה" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {CHIPS.map((chip) => {
            const on = status === chip.key
            const n = chip.key === 'all' ? total : counts[chip.key]
            return (
              <Link key={chip.key} href={href(chip.key)} aria-current={on ? 'page' : undefined} className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium ${on ? 'bg-brand text-white' : 'text-fg hover:bg-bg'}`}>
                {chip.label}
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/20' : 'bg-bg text-muted'}`}>{n}</span>
              </Link>
            )
          })}
        </nav>
        {served.length > 0 ? (
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, איש קשר או טלפון" aria-label="חיפוש ספק" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-fg outline-none focus:border-brand" />
        ) : null}
      </div>

      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-900' : 'border border-green-200 bg-green-50 text-green-900'}`}>
          {notice.text}
        </p>
      ) : null}

      {served.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-fg">{total === 0 ? 'עדיין אין ספקים שחתמו' : status === 'pending' ? 'כל הספקים שחתמו כבר הוקמו באתר' : 'אין ספקים בסטטוס הזה'}</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-8 text-center text-sm text-muted">לא נמצא ספק שמתאים לחיפוש.</p>
      ) : (
        <>
          {/* Phone: one card per supplier. */}
          <div className="flex flex-col gap-2 md:hidden">
            <label className="flex min-h-11 items-center gap-2 px-1 text-sm text-fg">
              <input type="checkbox" className="size-5" checked={allVisibleSelected} onChange={(e) => selectVisible(e.target.checked)} />
              בחר הכול
            </label>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.taskId} className={`rounded-xl border bg-surface p-4 ${selected.has(row.taskId) ? 'border-brand' : 'border-line'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-2">
                      <input type="checkbox" className="size-5 shrink-0" checked={selected.has(row.taskId)} onChange={() => toggle(row.taskId)} aria-label={`בחירת ${row.name}`} />
                      <span className="truncate text-base font-semibold text-fg">{row.name}</span>
                    </label>
                    <StatusChip status={row.status} />
                  </div>
                  <p className="mt-1 text-sm text-fg">
                    {row.contactName ?? '—'}
                    {row.contactPhone ? (
                      <>
                        {' · '}
                        <span dir="ltr">{row.contactPhone}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    חתם {day(row.signedAt)} · אחראי: {row.assigneeName ?? 'לא נבחר'}
                    {row.dueAt ? ` · עד ${day(row.dueAt)}` : ''}
                  </p>
                  {row.link ? (
                    <a href={row.link} target="_blank" rel="noreferrer" dir="ltr" className="mt-1 block truncate text-sm text-brand underline">
                      {shortLink(row.link)}
                    </a>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">{actions(row, false)}</div>
                </li>
              ))}
            </ul>
          </div>

          {/* Desktop: the compact table. */}
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-bg text-xs text-muted">
                <tr>
                  <th className="w-10 px-2 py-3">
                    <input type="checkbox" aria-label="בחר הכול" className="size-4" checked={allVisibleSelected} onChange={(e) => selectVisible(e.target.checked)} />
                  </th>
                  <th className="px-3 py-3 text-start font-medium">שם העסק</th>
                  <th className="px-3 py-3 text-start font-medium">איש קשר</th>
                  <th className="px-3 py-3 text-start font-medium">מועד חתימה</th>
                  <th className="px-3 py-3 text-start font-medium">סטטוס הקמה</th>
                  <th className="px-3 py-3 text-start font-medium">אחראי</th>
                  <th className="px-3 py-3 text-start font-medium">תאריך יעד</th>
                  <th className="px-3 py-3 text-start font-medium">קישור למוצר</th>
                  <th className="px-3 py-3 text-start font-medium">פעולה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.taskId} className={selected.has(row.taskId) ? 'bg-blue-50/40' : 'hover:bg-bg/60'}>
                    <td className="px-2 py-3">
                      <input type="checkbox" className="size-4" checked={selected.has(row.taskId)} onChange={() => toggle(row.taskId)} aria-label={`בחירת ${row.name}`} />
                    </td>
                    <td className="max-w-56 px-3 py-3 font-medium text-fg">
                      <span className="block truncate">{row.name}</span>
                    </td>
                    <td className="px-3 py-3 text-fg">
                      <span className="block truncate">{row.contactName ?? '—'}</span>
                      {row.contactPhone ? (
                        <span className="block text-xs text-muted" dir="ltr">
                          {row.contactPhone}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{day(row.signedAt)}</td>
                    <td className="px-3 py-3">
                      <StatusChip status={row.status} />
                    </td>
                    <td className="px-3 py-3 text-fg">{row.assigneeName ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-fg">{day(row.dueAt)}</td>
                    <td className="max-w-44 px-3 py-3">
                      {row.link ? (
                        <a href={row.link} target="_blank" rel="noreferrer" dir="ltr" className="block truncate text-brand underline">
                          {shortLink(row.link)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">{actions(row, true)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-brand bg-blue-50 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:sticky md:inset-x-auto md:bottom-auto md:top-2 md:rounded-xl md:border md:shadow-none" role="region" aria-label="פעולות על הנבחרים">
          <span className="text-sm font-semibold text-fg">נבחרו {selected.size}</span>
          <button type="button" onClick={() => setBulk('assign')} className={secondary}>
            שיוך אחראי
          </button>
          <button type="button" onClick={() => setBulk('in_progress')} className={secondary}>
            העבר לבטיפול
          </button>
          <button type="button" onClick={() => setBulk('due')} className={secondary}>
            קבע תאריך יעד
          </button>
          <button type="button" onClick={() => setBulk('done')} className={primary}>
            סמן כהוקם
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ms-auto inline-flex min-h-11 items-center px-2 text-sm text-brand underline-offset-4 hover:underline">
            ביטול
          </button>
        </div>
      ) : null}

      {bulk ? <BulkDialog kind={bulk} count={selected.size} team={team} onClose={() => setBulk(null)} onConfirm={(value) => runBulk(bulk, value)} /> : null}

      {marking ? (
        <MarkSetupDoneDialog
          projectId={projectId}
          task={{ id: marking.taskId, link: marking.link, note: marking.note }}
          name={marking.name}
          onClose={() => setDoneId(null)}
          onDone={(t) => {
            setDoneId(null)
            saved(t, `${marking.name} סומן כהוקם.`)
          }}
        />
      ) : null}

      {current ? (
        <Drawer
          open
          onClose={() => setOpenId(null)}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {current.name} <StatusChip status={current.status} />
            </span>
          }
        >
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">איש קשר</dt>
              <dd className="text-fg">{current.contactName ?? '—'}</dd>
              <dt className="text-muted">טלפון</dt>
              <dd className="text-fg" dir="ltr">
                {current.contactPhone ?? '—'}
              </dd>
              <dt className="text-muted">מועד חתימה</dt>
              <dd className="text-fg">{day(current.signedAt)}</dd>
            </dl>
            {current.companyId || current.agreementId ? (
              <div className="grid grid-cols-2 gap-2">
                {current.companyId ? (
                  <Link href={withReturnTo(`/companies/${current.companyId}`, here)} className={secondary}>
                    פתח ספק
                  </Link>
                ) : null}
                {current.agreementId ? (
                  <Link href={withReturnTo(`/documents/${current.agreementId}`, here)} className={secondary}>
                    פתח הסכם
                  </Link>
                ) : null}
              </div>
            ) : null}
            <section>
              <h3 className="text-sm font-semibold text-fg">הקמת מוצר באתר</h3>
              <div className="mt-2">
                <TaskPanel key={current.taskId} projectId={projectId} task={toSummary(current)} onSaved={(t) => saved(t, 'נשמר.')} />
              </div>
            </section>
          </div>
        </Drawer>
      ) : null}
    </section>
  )
}

/** One small question before a change lands on the whole selection: how many, and what exactly. */
function BulkDialog({ kind, count, team, onClose, onConfirm }: { kind: BulkKind; count: number; team: Member[]; onClose: () => void; onConfirm: (value: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const titles: Record<BulkKind, string> = { assign: 'שיוך אחראי', in_progress: 'העבר לבטיפול', due: 'קבע תאריך יעד', done: 'סמן כהוקם' }
  const sentence =
    kind === 'done' ? `${count === 1 ? 'לסמן משימה אחת כהוקמה?' : `לסמן ${count} משימות כהוקמו?`} רק אחרי שהעבודה בוצעה בפועל.`
    : kind === 'in_progress' ? (count === 1 ? 'משימה אחת תעבור לבטיפול.' : `${count} משימות יעברו לבטיפול.`)
    : kind === 'assign' ? `האחראי ייקבע ${inSome(count)}.`
    : `תאריך היעד ייקבע ${inSome(count)}.`

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-setup-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void confirm()
        }}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="bulk-setup-title" className="text-lg font-bold text-fg">
          {titles[kind]}
        </h2>
        <p className="mt-2 text-base text-fg">{sentence}</p>
        {kind === 'assign' ? (
          <label className="mt-3 block text-sm">
            <span className="text-muted">מי מטפל</span>
            <select value={value} onChange={(e) => setValue(e.target.value)} autoFocus className={`mt-1 ${field}`}>
              <option value="">לא נבחר</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === 'due' ? (
          <label className="mt-3 block text-sm">
            <span className="text-muted">עד מתי</span>
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)} autoFocus className={`mt-1 ${field}`} />
          </label>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="submit" disabled={busy || (kind === 'due' && !value)} className={`${primary} min-h-12 text-base`}>
            {busy ? 'מעדכן…' : 'אישור'}
          </button>
          <button type="button" onClick={onClose} className={`${secondary} min-h-12 text-base`}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
