'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TaskLine } from '@/components/follow-up/TaskBadge'
import { RowTasks } from '@/components/follow-up/RowTasks'
import { TaskPanel } from '@/components/follow-up/TaskPanel'
import { CopyButton } from '@/components/ui/CopyButton'
import { Drawer } from '@/components/ui/Drawer'
import { LinkCompanyPanel } from '@/components/invitations/LinkCompanyPanel'
import { FollowUpPanel, hasOpenWork } from '@/components/follow-up/FollowUpPanel'
import { JoiningProgressPanel, ProgressLine } from '@/components/progress/JoiningProgressPanel'
import { currentUrlFor, withReturnTo } from '@/lib/return-to'
import type { TaskSummary } from '@/server/follow-up/labels'
import type { AudienceRow, AudienceView, SendHistoryItem } from '@/server/invitations/invitations'
import { InviteDialog } from './InviteDialog'

/**
 * The rep's screen: who was reached, where each one is, what to do next.
 * One compact table, one drawer for the whole story, big buttons for the
 * daily actions — send again, remind, WhatsApp, copy the link, add as a
 * supplier or a customer, mark the site product as done.
 */
const VIEWS: { key: AudienceView; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'invited', label: 'הוזמנו ולא נרשמו' },
  { key: 'registered', label: 'נרשמו ולא חתמו' },
]
const STATUS: Record<AudienceRow['status'], { label: string; cls: string }> = {
  invited: { label: 'הוזמן', cls: 'bg-bg text-fg border-line' },
  registered: { label: 'נרשם', cls: 'bg-blue-50 text-blue-900 border-blue-200' },
  awaiting_signature: { label: 'ממתין לחתימה', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  signed: { label: 'חתם', cls: 'bg-green-50 text-green-900 border-green-200' },
  failed: { label: 'נכשל', cls: 'bg-red-50 text-red-900 border-red-200' },
}
const CHANNEL_WORD: Record<string, string> = { sms: 'SMS', email: 'מייל', whatsapp: 'WhatsApp' }
const EVENT_WORD: Record<string, string> = { invitation: 'הזמנה', reminder: 'תזכורת', signed_confirmation: 'עותק חתום', registration_completed: 'קישור לחתימה', distribution: 'הפצה', test: 'בדיקה' }
const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' })
const bigButton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-base font-semibold transition disabled:opacity-50'

export function AudienceTable({ projectId, rows, counts, view, q, askKind, dueToday, global = false, basePath, extraParams, hideViews = false }: { projectId: string; rows: AudienceRow[]; counts: Record<AudienceView, number>; view: AudienceView; q: string; askKind: boolean; dueToday: number; /** The organisation-wide tracking screen: a campaign column, no invite button. */ global?: boolean; basePath?: string; extraParams?: Record<string, string>; /** The campaign page draws its own view chips above the table. */ hideViews?: boolean }) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // A process to take off the list, waiting for a yes.
  const [removing, setRemoving] = useState<AudienceRow | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<{ eligible: { id: string; name: string; channel: string; kind: string }[]; skipped: { id: string; name: string; why: string }[] } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const current = rows.find((r) => r.id === openId) ?? null
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const selectable = rows.filter((r) => r.status !== 'signed' && r.status !== 'failed')

  async function previewReminders() {
    const ids = [...selected]
    const byGroup = new Map<string, string[]>()
    for (const id of ids) {
      const g = rows.find((r) => r.id === id)?.groupId ?? projectId
      byGroup.set(g, [...(byGroup.get(g) ?? []), id])
    }
    setBulkBusy(true)
    try {
      const merged = { eligible: [] as { id: string; name: string; channel: string; kind: string }[], skipped: [] as { id: string; name: string; why: string }[] }
      for (const [g, list] of byGroup) {
        const result = await post(`/api/projects/${g}/audience/remind`, { ids: list, dryRun: true })
        if (!result.ok) return setNotice({ tone: 'error', text: result.data?.error?.message ?? 'לא הצלחנו לבדוק את הזכאות.' })
        const d = result.data as unknown as { eligible: typeof merged.eligible; skipped: typeof merged.skipped }
        merged.eligible.push(...(d.eligible ?? []))
        merged.skipped.push(...(d.skipped ?? []))
      }
      setPlan(merged)
    } finally {
      setBulkBusy(false)
    }
  }

  async function sendReminders() {
    if (!plan) return
    const byGroup = new Map<string, string[]>()
    for (const row of plan.eligible) {
      const g = rows.find((r) => r.id === row.id)?.groupId ?? projectId
      byGroup.set(g, [...(byGroup.get(g) ?? []), row.id])
    }
    setBulkBusy(true)
    try {
      let sent = 0
      const failed: string[] = []
      for (const [g, list] of byGroup) {
        const result = await post(`/api/projects/${g}/audience/remind`, { ids: list })
        if (!result.ok) {
          failed.push(result.data?.error?.message ?? 'השליחה נכשלה.')
          continue
        }
        const d = result.data as unknown as { sent: number; failed: { name: string; message: string }[] }
        sent += d.sent ?? 0
        for (const f of d.failed ?? []) failed.push(`${f.name}: ${f.message}`)
      }
      setNotice(failed.length ? { tone: 'error', text: `נשלחו ${sent} תזכורות. לא נשלחו: ${failed.join(' · ')}` } : { tone: 'ok', text: `נשלחו ${sent} תזכורות.` })
      setPlan(null)
      setSelected(new Set())
      router.refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  const path = basePath ?? `/projects/${projectId}`
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(global ? extraParams ?? {} : { tab: 'joining', ...(extraParams ?? {}) })
    const next: { view?: string; q?: string; due?: string } = { view, q, ...patch }
    if (next.view && next.view !== 'all') p.set('view', next.view)
    if (next.q) p.set('q', next.q)
    if (next.due) p.set('due', '1')
    const qs = p.toString()
    return qs ? `${path}?${qs}` : path
  }

  return (
    <section className="flex flex-col gap-4">
      {!global ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="button" onClick={() => setInviteOpen(true)} className={`${bigButton} bg-brand text-white hover:opacity-90`}>
            + שליחת הזמנה
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {hideViews ? null : (
        <nav aria-label="תצוגות" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ view: v.key })} aria-current={view === v.key ? 'page' : undefined} className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium ${view === v.key ? 'bg-brand text-white' : 'text-fg hover:bg-bg'}`}>
              {v.label}
              <span className={`rounded-full px-1.5 text-xs ${view === v.key ? 'bg-white/20' : 'bg-bg text-muted'}`}>{counts[v.key]}</span>
            </Link>
          ))}
        </nav>
        )}
        <form method="get" action={path} className="flex min-w-0 flex-1 gap-2">
          {global ? Object.entries(extraParams ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : <input type="hidden" name="tab" value="joining" />}
          {view !== 'all' ? <input type="hidden" name="view" value={view} /> : null}
          <input type="search" name="q" defaultValue={q} placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש בקהל" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-fg outline-none focus:border-brand" />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
            חיפוש
          </button>
        </form>
      </div>

      {dueToday > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dueToday === 1 ? 'אחד לחזור אליו היום' : `${dueToday} לחזור אליהם היום`} —{' '}
          <Link href={href({ due: '1' })} className="font-semibold underline">
            הצגה
          </Link>
        </p>
      ) : null}

      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-900' : 'border border-green-200 bg-green-50 text-green-900'}`}>
          {notice.text}
        </p>
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-blue-50 px-4 py-3">
          <span className="text-sm font-semibold text-fg">נבחרו {selected.size}</span>
          <button type="button" disabled={bulkBusy} onClick={() => void previewReminders()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">
            שלח תזכורת לנבחרים
          </button>
          {selected.size < selectable.length ? (
            <button type="button" onClick={() => setSelected(new Set(selectable.map((r) => r.id)))} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
              בחר את כל התואמים ({selectable.length})
            </button>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} className="ms-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:text-fg">
            ביטול
          </button>
        </div>
      ) : null}

      {plan ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setPlan(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="rem-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="rem-title" className="text-lg font-bold text-fg">שליחת תזכורת</h3>
            <p className="mt-2 text-base text-fg">
              ניתן לשלוח ל-<strong>{plan.eligible.length}</strong> מתוך {plan.eligible.length + plan.skipped.length}.
            </p>
            <p className="mt-1 text-sm text-muted">{plan.eligible.filter((e) => e.channel === 'sms').length} ב-SMS · {plan.eligible.filter((e) => e.channel === 'email').length} באימייל · לפי נוסח התזכורת של הקמפיין.</p>
            {plan.skipped.length > 0 ? (
              <details className="mt-3 rounded-lg border border-line bg-bg p-3 text-sm">
                <summary className="cursor-pointer font-medium text-fg">{plan.skipped.length} לא יקבלו — למה?</summary>
                <ul className="mt-2 space-y-1 text-muted">
                  {plan.skipped.map((sk) => (
                    <li key={sk.id}>
                      {sk.name}: {sk.why}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={bulkBusy || plan.eligible.length === 0} onClick={() => void sendReminders()} className={`${bigButton} bg-brand text-white`}>
                {bulkBusy ? 'שולחים…' : `שלח ל-${plan.eligible.length}`}
              </button>
              <button type="button" onClick={() => setPlan(null)} className={`${bigButton} border border-line bg-surface text-fg`}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          {/* An empty list is a place to start from, not a dead end. */}
          <p className="text-base font-semibold text-fg">
            {q ? 'לא נמצא אף אחד בתצוגה הזו' : view === 'invitations' ? 'עדיין לא נשלחו הזמנות אישיות' : global ? 'עדיין אין הזמנות או הרשמות למעקב' : view !== 'all' ? 'לא נמצא אף אחד בתצוגה הזו' : 'עדיין לא נשלחו הזמנות'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {q ? 'נסו תצוגה אחרת או חיפוש אחר.' : view === 'invitations' ? 'כאן מופיעות רק הזמנות ששלחתם בעצמכם, כל עוד לא הושלמה בהן חתימה. מי שנרשם מעמוד הקמפיין מופיע בהרשמות.' : global ? 'הזמנות מקמפיינים ושליחות ישירות יופיעו כאן ברגע שיישלחו.' : view !== 'all' ? 'נסו תצוגה אחרת או חיפוש אחר.' : 'שלחו קישור אישי לספק או ללקוח, גם אם הוא עדיין אינו נמצא במערכת.'}
          </p>
          {!q && (view === 'all' || view === 'invitations') && !global ? (
            <button type="button" onClick={() => setInviteOpen(true)} className={`${bigButton} mt-5 bg-brand text-white`}>
              + שליחת הזמנה
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Phone: one card per person. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <div role="button" tabIndex={0} onClick={() => setOpenId(row.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(row.id) } }} className="flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-start">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {row.status !== 'signed' && row.status !== 'failed' ? <input type="checkbox" className="size-5" checked={selected.has(row.id)} onChange={() => toggle(row.id)} onClick={(e) => e.stopPropagation()} aria-label={`בחירת ${row.name}`} /> : null}
                      <span className="truncate text-base font-semibold text-fg">{row.name}</span>
                    </span>
                    <StatusChip status={row.status} />
                  </span>
                  <ProgressLine progress={row.progress} />
                  <span className="text-sm text-muted" dir="ltr">
                    {row.phone ?? row.email ?? ''}
                  </span>
                  <span className="text-xs text-muted">
                    {global ? `${row.groupName} · ` : ''}{row.lastActivity} · {dateFormat.format(new Date(row.lastActivityAt ?? row.createdAt))}
                    {row.assignee ? ` · ${row.assignee.name}` : row.invitedBy ? ` · ${row.invitedBy.name}` : ''}
                  </span>
                  <RowTasks projectId={projectId} tasks={row.tasks} name={row.name} onChange={() => router.refresh()} />
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: the compact table. */}
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
            <table className="w-full min-w-[800px] table-fixed text-sm">
              <thead className="bg-bg text-xs text-muted">
                <tr>
                  <th className="w-10 px-2 py-3">
                    <input type="checkbox" aria-label="בחירת הכול" className="size-4" checked={selectable.length > 0 && selectable.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())} />
                  </th>
                  <th className="w-[24%] px-4 py-3 text-start font-medium">שם</th>
                  {global ? <th className="w-[14%] px-4 py-3 text-start font-medium">קמפיין</th> : null}
                  <th className="w-[14%] px-4 py-3 text-start font-medium">טלפון</th>
                  <th className="w-[18%] px-4 py-3 text-start font-medium">סטטוס</th>
                  <th className="w-[13%] px-4 py-3 text-start font-medium">נציג</th>
                  <th className="px-4 py-3 text-start font-medium">פעילות אחרונה</th>
                  <th className="sticky end-0 w-14 bg-bg px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => setOpenId(row.id)} className="cursor-pointer hover:bg-bg/60">
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {row.status !== 'signed' && row.status !== 'failed' ? <input type="checkbox" className="size-4" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`בחירת ${row.name}`} /> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium text-fg">{row.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {row.kind === 'customer' ? 'לקוח' : row.kind === 'supplier' ? 'ספק' : ''}
                        {row.companyName ? ` · ${row.companyName}` : ''}
                        {row.linkingNeeded ? ' · לא שויך ב-CRM' : ''}
                      </span>
                    </td>
                    {global ? (
                      <td className="px-4 py-3 text-fg">
                        <span className="block truncate">{row.groupName}</span>
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-fg" dir="ltr">
                      <span className="block truncate">{row.phone ?? row.email ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={row.status} />
                      <ProgressLine progress={row.progress} className="mt-1" />
                      <RowTasks projectId={projectId} tasks={row.tasks} name={row.name} onChange={() => router.refresh()} className="mt-1" />
                    </td>
                    <td className="px-4 py-3 text-fg">
                      <span className="block truncate">{row.assignee?.name ?? row.invitedBy?.name ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <span className="block truncate">{row.lastActivity}</span>
                      <span className="block text-xs">{dateFormat.format(new Date(row.lastActivityAt ?? row.createdAt))}</span>
                    </td>
                    <td className="sticky end-0 bg-surface px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <RowMenu row={row} projectId={row.groupId || projectId} onOpen={() => setOpenId(row.id)} onNotice={setNotice} onRemove={() => setRemoving(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {inviteOpen ? <InviteDialog projectId={projectId} askKind={askKind} onClose={() => setInviteOpen(false)} /> : null}
      {current ? <PersonDrawer row={current} projectId={current.groupId || projectId} onClose={() => setOpenId(null)} onNotice={setNotice} onRemove={() => setRemoving(current)} /> : null}

      {removing ? (
        <ConfirmRemove
          row={removing}
          busy={removeBusy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            setRemoveBusy(true)
            try {
              const response = await fetch(`/api/invitations/${removing.id}`, { method: 'DELETE' })
              const data = (await response.json().catch(() => null)) as { canceledAgreement?: boolean; error?: { message?: string } } | null
              if (!response.ok) {
                setNotice({ tone: 'error', text: data?.error?.message ?? 'המחיקה נכשלה.' })
                return
              }
              setNotice({ tone: 'ok', text: data?.canceledAgreement ? `${removing.name} נמחק מהרשימה, וההסכם שנשלח בוטל.` : `${removing.name} נמחק מהרשימה.` })
              setRemoving(null)
              setOpenId(null)
              router.refresh()
            } catch {
              setNotice({ tone: 'error', text: 'המחיקה נכשלה. בדקו את החיבור לאינטרנט.' })
            } finally {
              setRemoveBusy(false)
            }
          }}
        />
      ) : null}
    </section>
  )
}

function StatusChip({ status }: { status: AudienceRow['status'] }) {
  const s = STATUS[status]
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
}

// ── actions shared by the menu and the drawer ───────────────────────────────

async function post(url: string, body?: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const data = await response.json().catch(() => null)
  return { ok: response.ok, data }
}

function useActions(row: AudienceRow, projectId: string, onNotice: (n: { tone: 'ok' | 'error'; text: string }) => void) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [whatsapp, setWhatsapp] = useState<{ sendId: string; url: string } | null>(null)
  const hasAgreement = Boolean(row.agreementId) && row.status !== 'invited'

  async function run(label: string, fn: () => Promise<{ ok: boolean; data: { error?: { message?: string }; whatsapp?: { sendId: string; url: string }; url?: string; whatsappUrl?: string } | null }>) {
    setBusy(true)
    try {
      const result = await fn()
      if (!result.ok) {
        onNotice({ tone: 'error', text: result.data?.error?.message ?? `${label} נכשל.` })
        return
      }
      if (result.data?.whatsapp) {
        window.open(result.data.whatsapp.url, '_blank', 'noopener')
        setWhatsapp(result.data.whatsapp)
      } else if (result.data?.whatsappUrl) {
        window.open(result.data.whatsappUrl, '_blank', 'noopener')
      } else {
        onNotice({ tone: 'ok', text: `${label} — בוצע.` })
      }
      router.refresh()
    } catch {
      onNotice({ tone: 'error', text: `${label} נכשל. בדקו את החיבור לאינטרנט.` })
    } finally {
      setBusy(false)
    }
  }

  const send = (channel: 'sms' | 'email' | 'whatsapp') => {
    const label = channel === 'whatsapp' ? 'פתיחת WhatsApp' : `שליחה ב-${CHANNEL_WORD[channel]}`
    if (hasAgreement) {
      // The agreement exists: the reminder carries the signing link.
      if (channel === 'whatsapp') return run(label, () => post(`/api/projects/${projectId}/registrations/${row.id}/share-link`, { via: 'whatsapp' }))
      return run(label, () => post(`/api/projects/${projectId}/registrations/actions`, { ids: [row.id], action: 'remind', channels: [channel] }))
    }
    return run(label, () => post(`/api/invitations/${row.id}/send`, { channel, attemptKey: `${crypto.randomUUID()}:${channel}` }))
  }

  async function confirmWhatsapp(sent: boolean) {
    if (!whatsapp) return
    await post(`/api/sends/${whatsapp.sendId}/confirm`, { sent })
    setWhatsapp(null)
    onNotice({ tone: sent ? 'ok' : 'error', text: sent ? 'סומן כנשלח ב-WhatsApp.' : 'סומן כלא נשלח.' })
    router.refresh()
  }

  return { busy, send, whatsapp, confirmWhatsapp, hasAgreement }
}

function WhatsappConfirm({ onConfirm }: { onConfirm: (sent: boolean) => void }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">WhatsApp נפתח עם ההודעה. ההודעה נשלחה?</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onConfirm(true)} className={`${bigButton} bg-brand text-white`}>
          כן, נשלחה
        </button>
        <button type="button" onClick={() => onConfirm(false)} className={`${bigButton} border border-line bg-surface text-fg`}>
          לא נשלחה
        </button>
      </div>
    </div>
  )
}

function RowMenu({ row, projectId, onOpen, onNotice, onRemove }: { row: AudienceRow; projectId: string; onOpen: () => void; onNotice: (n: { tone: 'ok' | 'error'; text: string }) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 })
  const { busy, send, whatsapp, confirmWhatsapp } = useActions(row, projectId, onNotice)
  const here = currentUrlFor(usePathname(), useSearchParams())

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const items: { label: string; run: () => void; danger?: boolean }[] = [
    { label: 'פרטים', run: onOpen },
    ...(row.status !== 'signed' && row.status !== 'failed'
      ? [
          ...(row.phone ? [{ label: 'שלח שוב ב-SMS', run: () => void send('sms') }] : []),
          ...(row.email ? [{ label: 'שלח שוב במייל', run: () => void send('email') }] : []),
          ...(row.phone ? [{ label: 'WhatsApp', run: () => void send('whatsapp') }] : []),
        ]
      : []),
    ...(row.agreementId ? [{ label: 'פתח הסכם', run: () => window.open(withReturnTo(`/documents/${row.agreementId}`, here), '_self') }] : []),
    ...(row.companyId ? [{ label: 'פתח ספק/לקוח', run: () => window.open(withReturnTo(`/companies/${row.companyId}`, here), '_self') }] : [{ label: 'הוסף כספק/לקוח', run: onOpen }]),
    // Signed is final: it can be archived from the agreement, never deleted here.
    ...(row.status !== 'signed' ? [{ label: 'מחיקה מהרשימה', run: onRemove, danger: true }] : []),
  ]

  return (
    <>
      <button
        type="button"
        aria-label="פעולות"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const width = 224
          const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width - width))
          setStyle(r.bottom + 260 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 })
          setOpen((v) => !v)
        }}
        className="inline-flex size-11 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-fg"
      >
        ⋯
      </button>
      {open
        ? createPortal(
            <div role="menu" dir="rtl" style={style} onMouseDown={(e) => e.stopPropagation()} className="fixed z-40 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.run()
                  }}
                  className={`block w-full px-4 py-2.5 text-start text-sm hover:bg-bg ${item.danger ? 'text-red-700' : 'text-fg'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {whatsapp ? createPortal(<div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:inset-x-auto sm:end-4 sm:w-96"><WhatsappConfirm onConfirm={(s) => void confirmWhatsapp(s)} /></div>, document.body) : null}
    </>
  )
}

// ── the drawer: the whole story of one person ───────────────────────────────

function PersonDrawer({ row, projectId, onClose, onNotice, onRemove }: { row: AudienceRow; projectId: string; onClose: () => void; onNotice: (n: { tone: 'ok' | 'error'; text: string }) => void; onRemove: () => void }) {
  const router = useRouter()
  const { busy, send, whatsapp, confirmWhatsapp, hasAgreement } = useActions(row, projectId, onNotice)
  const here = currentUrlFor(usePathname(), useSearchParams())
  const [history, setHistory] = useState<SendHistoryItem[] | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // Each task keeps what this person changed until the next refresh.
  const [tasks, setTasks] = useState<TaskSummary[]>(row.tasks)

  useEffect(() => {
    let live = true
    void fetch(`/api/invitations/${row.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return
        setHistory(Array.isArray(d.history) ? d.history : [])
      })
      .catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [row.id])

  async function copyLink() {
    // A fresh personal link on the same agreement: to sign, or to download the signed copy.
    const result = await post(`/api/projects/${projectId}/registrations/${row.id}/share-link`, { via: 'copy' })
    const url = result.ok ? result.data?.url : null
    if (!url) return onNotice({ tone: 'error', text: result.data?.error?.message ?? 'אין קישור לשיתוף.' })
    await navigator.clipboard.writeText(url).catch(() => null)
    setLink(url)
    onNotice({ tone: 'ok', text: 'הקישור הועתק.' })
  }

  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2">{row.name} <StatusChip status={row.status} /></span>}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">טלפון</dt>
          <dd className="text-fg" dir="ltr">{row.phone ?? '—'}</dd>
          <dt className="text-muted">אימייל</dt>
          <dd className="truncate text-fg" dir="ltr">{row.email ?? '—'}</dd>
          <dt className="text-muted">סוג</dt>
          <dd className="text-fg">{row.kind === 'customer' ? 'לקוח' : row.kind === 'supplier' ? 'ספק' : '—'}</dd>
          <dt className="text-muted">הוזמן על ידי</dt>
          <dd className="text-fg">{row.invitedBy?.name ?? '—'}</dd>
          <dt className="text-muted">פעילות אחרונה</dt>
          <dd className="text-fg">{row.lastActivity}</dd>
          {row.companyName ? (
            <>
              <dt className="text-muted">ספק/לקוח</dt>
              <dd>
                <Link href={withReturnTo(`/companies/${row.companyId}`, here)} className="text-brand underline">
                  {row.companyName}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>

        <JoiningProgressPanel progress={row.progress} />

        {whatsapp ? <WhatsappConfirm onConfirm={(s) => void confirmWhatsapp(s)} /> : null}

        <section>
          <h3 className="text-sm font-semibold text-fg">פעולות</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {row.status !== 'signed' && row.status !== 'failed' ? (
              <>
                {row.phone ? (
                  <button type="button" disabled={busy} onClick={() => void send('sms')} className={`${bigButton} bg-brand text-white`}>
                    {hasAgreement ? 'תזכורת ב-SMS' : 'שלח שוב ב-SMS'}
                  </button>
                ) : null}
                {row.email ? (
                  <button type="button" disabled={busy} onClick={() => void send('email')} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
                    {hasAgreement ? 'תזכורת במייל' : 'שלח שוב במייל'}
                  </button>
                ) : null}
                {row.phone ? (
                  <button type="button" disabled={busy} onClick={() => void send('whatsapp')} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
                    WhatsApp
                  </button>
                ) : null}
              </>
            ) : null}
            {hasAgreement ? (
              <button type="button" disabled={busy} onClick={() => void copyLink()} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
                {row.status === 'signed' ? 'העתק קישור לעותק' : 'העתק קישור המשך'}
              </button>
            ) : null}
            {row.agreementId ? (
              <Link href={withReturnTo(`/documents/${row.agreementId}`, here)} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
                פתח הסכם
              </Link>
            ) : null}
            {row.status === 'signed' && row.agreementId ? (
              <a href={`/api/documents/${row.agreementId}/download`} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
                הורדת PDF חתום
              </a>
            ) : null}
          </div>
          {link ? <CopyButton text={link} label="העתק שוב" className="mt-2 text-xs text-brand underline" /> : null}
          {row.status !== 'signed' ? (
            <button type="button" onClick={onRemove} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 transition hover:border-red-400">
              מחיקה מהרשימה
            </button>
          ) : null}
        </section>

        {!row.companyId ? (
          <LinkCompanyPanel
            leadId={row.id}
            onDone={() => {
              onNotice({ tone: 'ok', text: 'נוסף למאגר.' })
              router.refresh()
            }}
            onError={(m) => onNotice({ tone: 'error', text: m })}
          />
        ) : null}

        {tasks.map((task) => (
          <section key={task.id}>
            <h3 className="text-sm">
              <TaskLine task={task} />
            </h3>
            <div className="mt-2">
              <TaskPanel projectId={projectId} task={task} onSaved={(t) => { setTasks((list) => list.map((x) => (x.id === t.id ? t : x))); router.refresh() }} />
            </div>
          </section>
        ))}

        <FollowUpPanel
          leadId={row.id}
          values={{ assigneeUserId: row.assignee?.id ?? null, followUpAt: row.followUpAt, callOutcome: row.callOutcome, internalNote: row.internalNote }}
          openWork={hasOpenWork({ signed: row.status === 'signed', taskStatuses: tasks.map((t) => t.status), followUpAt: row.followUpAt, assigneeUserId: row.assignee?.id ?? null, callOutcome: row.callOutcome })}
          doneText={tasks.length ? 'ההצטרפות וכל המשימות הושלמו.' : 'ההצטרפות הושלמה.'}
          onSaved={() => onNotice({ tone: 'ok', text: 'נשמר.' })}
          onError={(m) => onNotice({ tone: 'error', text: m })}
        />

        <section>
          <h3 className="text-sm font-semibold text-fg">היסטוריית שליחות</h3>
          {history === null ? (
            <p className="mt-2 text-sm text-muted">טוען…</p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-muted">עדיין לא נשלחה הודעה.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-fg">
                    {EVENT_WORD[h.event] ?? h.event} ב-{CHANNEL_WORD[h.channel] ?? h.channel} <span className="text-muted" dir="ltr">{h.to}</span>
                  </span>
                  <span className={`text-xs ${h.channel === 'whatsapp' ? (h.manualState === 'sent' ? 'text-green-800' : h.manualState === 'not_sent' ? 'text-red-700' : 'text-amber-800') : h.ok ? 'text-green-800' : 'text-red-700'}`}>
                    {h.channel === 'whatsapp' ? (h.manualState === 'sent' ? 'סומן כנשלח' : h.manualState === 'not_sent' ? 'לא נשלח' : 'נפתח, לא אושר') : h.ok ? 'נשלח' : 'נכשל'} · {dayFormat.format(new Date(h.at))}
                    {h.by ? ` · ${h.by}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  )
}

/**
 * Deleting is small but not reversible, so the question names exactly what
 * goes and what stays: the process leaves the list, an agreement already sent
 * is canceled, and the supplier or customer stays in the database.
 */
function ConfirmRemove({ row, busy, onCancel, onConfirm }: { row: AudienceRow; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="remove-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <h2 id="remove-title" className="text-lg font-bold text-fg">
          למחוק את {row.name} מהרשימה?
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-1 ps-5 text-sm text-fg">
          <li>הרשומה תיעלם מהקמפיין ומהמעקב.</li>
          {row.agreementId ? <li>ההסכם שנשלח יבוטל והקישור יפסיק לעבוד.</li> : null}
          {row.companyId ? <li>הספק/לקוח עצמו יישאר במאגר.</li> : null}
          <li>אי אפשר לבטל את המחיקה.</li>
        </ul>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={onConfirm} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-red-600 px-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'מוחקים…' : 'כן, מחק'}
          </button>
          <button type="button" onClick={onCancel} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-base font-medium text-fg transition hover:border-brand">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
