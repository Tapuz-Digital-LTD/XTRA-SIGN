'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { RowMenu, type RowMenuItem } from '@/components/deletion/RowMenu'
import { Drawer } from '@/components/ui/Drawer'
import { LinkCompanyPanel } from '@/components/invitations/LinkCompanyPanel'
import type { ActionPlan, ActionResult, RegistrationAction, RegistrationDetail } from '@/server/reports/registration-actions'
import type { ProjectReportData } from './ProjectReportView'
import { EditLeadDialog } from '@/components/projects/LeadsPanel'
import { TaskBadge } from '@/components/follow-up/TaskBadge'
import { TaskFilterChips } from '@/components/follow-up/TaskFilterChips'
import { TaskPanel } from '@/components/follow-up/TaskPanel'
import type { TaskSummary } from '@/server/follow-up/labels'

/**
 * Registrations as a summary you can act on: five columns, a status chip,
 * one quick action, a "⋯" with the rest, checkboxes for many at once. A
 * click opens the drawer with everything — the business, the submission,
 * the agreement, the timeline. The server decides who is eligible for what
 * and says so before a message leaves.
 */

type Row = ProjectReportData['registrations'][number]

const dateTime = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
const longDateTime = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jerusalem' })
const number = new Intl.NumberFormat('he-IL')

const TONE: Record<Row['statusTone'], string> = {
  ok: 'bg-green-50 text-green-800',
  wait: 'bg-amber-50 text-amber-800',
  muted: 'bg-line text-muted',
  bad: 'bg-red-50 text-red-800',
}

const buttonClass = 'inline-flex min-h-9 items-center justify-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand disabled:opacity-50'
const primaryClass = 'inline-flex min-h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

const TIMELINE_LABELS: Record<string, string> = {
  registered: 'נרשם',
  sent: 'נשלח',
  email_sent: 'נשלח אימייל',
  sms_sent: 'נשלח SMS',
  email_failed: 'שליחת אימייל נכשלה',
  sms_failed: 'שליחת SMS נכשלה',
  whatsapp_share_opened: 'שותף ב-WhatsApp',
  viewed: 'צפה בהסכם',
  reminder_sent: 'נשלחה תזכורת',
  signature_applied: 'חתם',
  completed: 'החתימה הושלמה',
  declined: 'סירב',
  canceled: 'בוטל',
  expired: 'פג תוקף',
  archived: 'הועבר לארכיון',
  restored: 'הוחזר מהארכיון',
  removed: 'הוסר',
}

type Pending = { action: RegistrationAction; ids: string[]; plan: ActionPlan | null; channels: ('sms' | 'email')[] }

export function RegistrationsTable({
  projectId,
  rows,
  total,
  title = 'הרשמות בקמפיין',
  audienceNoun = 'ספק',
}: {
  projectId: string
  rows: Row[]
  total: number
  title?: string
  /** What an approved lead becomes: ספק or לקוח. */
  audienceNoun?: 'ספק' | 'לקוח'
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Row | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Follow-up tasks: the chip on a row changes before the server answers,
  // so the row keeps its own copy until the next refresh.
  const [taskOverrides, setTaskOverrides] = useState<Record<string, TaskSummary>>({})
  const [taskVersion, setTaskVersion] = useState(0)
  const [marking, setMarking] = useState<string[] | null>(null)
  const taskFilter = useSearchParams().get('taskFilter')

  const taskOf = (r: Row): TaskSummary | null => taskOverrides[r.id] ?? r.task
  const setTask = (leadId: string, task: TaskSummary) => {
    setTaskOverrides((o) => ({ ...o, [leadId]: task }))
    setTaskVersion((v) => v + 1)
  }
  // ponytail: filtered over the rows on screen (200 at most). Beyond that,
  // add a taskFilter condition to rowConditions and pass query.taskFilter from the page.
  const visible = taskFilter ? rows.filter((r) => taskOf(r)?.status === taskFilter) : rows

  const status = (r: Row) => r.agreement?.status ?? r.registrationStatus
  const canRemind = (r: Row) => status(r) === 'sent' || status(r) === 'viewed'
  const isSigned = (r: Row) => status(r) === 'signed'
  const failed = (r: Row) => r.registrationStatus === 'failed'
  const needsPerson = (r: Row) => r.registrationStatus === 'new'

  async function leadAction(r: Row, action: 'approve' | 'reject') {
    if (action === 'reject' && !window.confirm('לדחות את ההרשמה? הפרטים יישמרו אך לא ייווצר ' + audienceNoun + '.')) return
    const response = await fetch(`/api/projects/${projectId}/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, leadId: r.id }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setNotice({ tone: 'error', text: data?.error?.message ?? 'הפעולה נכשלה.' })
      return
    }
    setNotice({ tone: 'ok', text: action === 'approve' ? `ההרשמה אושרה ו${audienceNoun === 'ספק' ? 'הספק נוצר' : 'הלקוח נוצר'}.` : 'ההרשמה נדחתה.' })
    router.refresh()
  }

  async function share(r: Row, via: 'whatsapp' | 'copy') {
    const response = await fetch(`/api/projects/${projectId}/registrations/${r.id}/share-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via }) })
    const data = (await response.json().catch(() => null)) as { url?: string; text?: string; whatsappUrl?: string; error?: { message?: string } } | null
    if (!response.ok || !data?.url) {
      setNotice({ tone: 'error', text: data?.error?.message ?? 'לא הצלחנו להכין קישור.' })
      return
    }
    if (via === 'whatsapp') {
      window.open(data.whatsappUrl, '_blank', 'noopener')
      return
    }
    try {
      await navigator.clipboard.writeText(data.text ?? data.url)
      setNotice({ tone: 'ok', text: 'ההודעה עם הקישור הועתקה.' })
    } catch {
      window.prompt('העתיקו את הקישור:', data.url)
    }
  }

  function ask(action: RegistrationAction, ids: string[]) {
    setPending({ action, ids, plan: null, channels: action === 'send_signed_copy' ? ['email'] : ['sms', 'email'] })
    void fetch(`/api/projects/${projectId}/registrations/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action, dryRun: true }) })
      .then(async (r) => (r.ok ? ((await r.json()) as ActionPlan) : null))
      .then((plan) => setPending((p) => (p && p.action === action ? { ...p, plan } : p)))
      .catch(() => {})
  }

  async function confirm() {
    if (!pending) return
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/registrations/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: pending.ids, action: pending.action, channels: pending.channels }),
      })
      const data = (await response.json().catch(() => null)) as (ActionResult & { error?: { message?: string } }) | null
      if (!response.ok || !data) {
        setNotice({ tone: 'error', text: data?.error?.message ?? 'הפעולה נכשלה.' })
        return
      }
      const failedCount = data.failed.length
      setNotice({ tone: failedCount ? 'error' : 'ok', text: `נשלח ל-${data.sent.length} נמענים${failedCount ? `, ${failedCount} נכשלו` : ''}${data.skipped.length ? `, ${data.skipped.length} דולגו` : ''}.` })
      setPending(null)
      setSelected(new Set())
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function markDone() {
    if (!marking) return
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: marking, status: 'done' }),
      })
      const data = (await response.json().catch(() => null)) as { updated?: number; error?: { message?: string } } | null
      if (!response.ok || !data) {
        setNotice({ tone: 'error', text: data?.error?.message ?? 'הפעולה נכשלה.' })
        return
      }
      setNotice({ tone: 'ok', text: `${data.updated ?? 0} משימות סומנו כהוקמו.` })
      setMarking(null)
      setSelected(new Set())
      setTaskVersion((v) => v + 1)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const openTaskIds = (ids: Iterable<string>) =>
    [...ids].map((id) => rows.find((r) => r.id === id)).map((r) => (r ? taskOf(r) : null)).filter((t): t is TaskSummary => Boolean(t && (t.status === 'pending' || t.status === 'in_progress'))).map((t) => t.id)

  const taskBadge = (r: Row) => {
    const task = taskOf(r)
    return isSigned(r) && task ? <TaskBadge projectId={projectId} task={task} onChange={(t) => setTask(r.id, t)} onError={(text) => setNotice({ tone: 'error', text })} /> : null
  }

  const menuFor = (r: Row): (RowMenuItem | null)[] => [
    { label: 'פתח פרטים', onSelect: () => setOpenId(r.id) },
    needsPerson(r) ? { label: `אשר והפוך ל${audienceNoun}`, onSelect: () => void leadAction(r, 'approve') } : null,
    needsPerson(r) ? { label: 'ערוך פרטים', onSelect: () => setEditing(r) } : null,
    needsPerson(r) ? { label: 'דחה', danger: true, onSelect: () => void leadAction(r, 'reject') } : null,
    r.companyId ? { label: 'פתח ספק', onSelect: () => router.push(`/companies/${r.companyId}`) } : null,
    r.agreement ? { label: isSigned(r) ? 'צפייה בהסכם' : 'פתח הסכם', onSelect: () => router.push(`/documents/${r.agreement!.id}`) } : null,
    isSigned(r) && r.agreement ? { label: 'הורדת המסמך החתום', onSelect: () => window.open(`/api/documents/${r.agreement!.id}/download`, '_blank') } : null,
    isSigned(r) ? { label: 'שלח עותק במייל', onSelect: () => ask('send_signed_copy', [r.id]) } : null,
    isSigned(r) ? { label: 'שתף קישור מאובטח', onSelect: () => void share(r, 'whatsapp') } : null,
    canRemind(r) ? { label: 'שלח תזכורת', onSelect: () => ask('remind', [r.id]) } : null,
    canRemind(r) ? { label: 'שלח שוב', onSelect: () => ask('resend', [r.id]) } : null,
    status(r) === 'expired' ? { label: 'חדש קישור לחתימה', onSelect: () => ask('renew', [r.id]) } : null,
    canRemind(r) ? { label: 'שתף ב-WhatsApp', onSelect: () => void share(r, 'whatsapp') } : null,
    canRemind(r) || isSigned(r) ? { label: 'העתק קישור', onSelect: () => void share(r, 'copy') } : null,
    failed(r) && r.companyId ? { label: 'ערוך פרטי קשר', onSelect: () => router.push(`/companies/${r.companyId}?edit=1`) } : null,
  ]

  const quick = (r: Row) =>
    needsPerson(r) ? (
      <button type="button" onClick={() => void leadAction(r, 'approve')} className={buttonClass}>
        אשר
      </button>
    ) : canRemind(r) ? (
      <button type="button" onClick={() => ask('remind', [r.id])} className={buttonClass}>
        שלח תזכורת
      </button>
    ) : isSigned(r) && r.agreement ? (
      <Link href={`/documents/${r.agreement.id}`} className={buttonClass}>
        פתח מסמך
      </Link>
    ) : failed(r) && r.agreement ? (
      <button type="button" onClick={() => ask('resend', [r.id])} className={buttonClass}>
        נסה שוב
      </button>
    ) : null

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.id)))
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="rp-registrations">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rp-registrations" className="text-sm font-semibold text-fg">{title}</h2>
        <p className="text-xs text-muted">
          {total > rows.length ? `מוצגות ${rows.length} מתוך ${number.format(total)} — הקובץ המלא בייצוא` : `${number.format(rows.length)} הרשמות`}
        </p>
      </div>

      <div className="mt-3 empty:hidden">
        <TaskFilterChips projectId={projectId} version={taskVersion} />
      </div>

      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2 text-sm">
          <span className="text-fg">{selected.size} נבחרו</span>
          <button type="button" onClick={() => ask('remind', [...selected])} className={buttonClass}>
            שלח תזכורת
          </button>
          <button type="button" onClick={() => ask('resend', [...selected])} className={buttonClass}>
            שלח שוב
          </button>
          <button type="button" onClick={() => ask('send_signed_copy', [...selected])} className={buttonClass}>
            שלח עותק חתום במייל
          </button>
          {openTaskIds(selected).length > 0 ? (
            <button type="button" onClick={() => setMarking(openTaskIds(selected))} className={buttonClass}>
              סמן כהוקם
            </button>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:underline">
            ניקוי הבחירה
          </button>
        </div>
      ) : null}

      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
          {notice.text}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted">אין הרשמות בטווח ובסינון שנבחרו.</p>
      ) : (
        <>
          {/* phones: one card per registration */}
          <ul className="mt-3 flex flex-col gap-2 md:hidden">
            {visible.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-bg p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 size-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`בחירת ${r.businessName}`} />
                  <button type="button" onClick={() => setOpenId(r.id)} className="min-w-0 flex-1 text-start">
                    <span className="block truncate text-sm font-medium text-fg">{r.businessName || '—'}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {r.contactName || '—'} · {dateTime.format(new Date(r.createdAt))} · {r.source.label}
                    </span>
                  </button>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.statusTone]}`}>{r.statusLabel}</span>
                    {r.linkingNeeded ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">לא שויך ב-CRM</span> : null}
                  </span>
                  <RowMenu items={menuFor(r)} />
                </div>
                {quick(r) || taskBadge(r) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {quick(r)}
                    {taskBadge(r)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {/* wider screens: the summary table */}
          <div className="mt-3 hidden md:block">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="w-8 py-2">
                    <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleAll} aria-label="בחירת כל ההרשמות" />
                  </th>
                  <th className="w-[24%] py-2 pe-3 text-start font-medium">עסק</th>
                  <th className="w-[17%] py-2 pe-3 text-start font-medium">איש קשר</th>
                  <th className="w-[14%] py-2 pe-3 text-start font-medium">סטטוס</th>
                  <th className="w-[12%] py-2 pe-3 text-start font-medium">נרשם</th>
                  <th className="w-[11%] py-2 pe-3 text-start font-medium">מקור</th>
                  <th className="py-2 text-start font-medium">
                    <span className="sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-bg" onClick={() => setOpenId(r.id)}>
                    <td className="py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="size-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`בחירת ${r.businessName}`} />
                    </td>
                    <td className="truncate py-2 pe-3 font-medium text-fg" title={r.businessName}>
                      {r.businessName || '—'}
                      {r.taxId ? <span className="ms-2 text-xs font-normal text-muted tabular-nums" dir="ltr">{r.taxId}</span> : null}
                    </td>
                    <td className="truncate py-2 pe-3 text-fg">{r.contactName || '—'}</td>
                    <td className="py-2 pe-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.statusTone]}`}>{r.statusLabel}</span>
                      {r.linkingNeeded ? <span className="mt-1 block"><span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">לא שויך ב-CRM — בדקו שיוך</span></span> : null}
                      {taskBadge(r) ? <div className="mt-1" onClick={(e) => e.stopPropagation()}>{taskBadge(r)}</div> : null}
                    </td>
                    <td className="whitespace-nowrap py-2 pe-3 tabular-nums text-muted">{dateTime.format(new Date(r.createdAt))}</td>
                    <td className="truncate py-2 pe-3 text-muted">{r.source.label}</td>
                    <td className="py-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {quick(r)}
                        <RowMenu items={menuFor(r)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <RegistrationDrawer
        projectId={projectId}
        id={openId}
        linkingNeeded={Boolean(openId && rows.find((x) => x.id === openId)?.linkingNeeded)}
        task={openId ? (() => { const r = rows.find((x) => x.id === openId); return r && isSigned(r) ? taskOf(r) : null })() : null}
        onTaskSaved={(t) => { if (openId) setTask(openId, t) }}
        onClose={() => setOpenId(null)}
        onAct={(action, id) => ask(action, [id])}
        onShare={(id, via) => { const r = rows.find((x) => x.id === id); if (r) void share(r, via) }}
      />
      {editing ? (
        <EditLeadDialog
          projectId={projectId}
          leadId={editing.id}
          initial={{ name: editing.businessName, taxId: editing.taxId, contactName: editing.contactName, phone: editing.phone, email: editing.email }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      ) : null}

      {marking ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={() => setMarking(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="mk-title" className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="mk-title" className="text-base font-semibold text-fg">סימון כהוקם</h3>
            <p className="mt-2 text-sm text-fg">{marking.length === 1 ? 'משימה אחת תסומן כהוקמה באתר.' : `${marking.length} משימות יסומנו כהוקמו באתר.`}</p>
            <p className="mt-2 text-xs text-muted">ההסכמים עצמם לא משתנים — רק מצב ההקמה.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setMarking(null)} className={buttonClass}>
                ביטול
              </button>
              <button type="button" disabled={busy} onClick={() => void markDone()} className={primaryClass}>
                {busy ? 'מסמן…' : `סמן כהוקם (${marking.length})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={() => setPending(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ra-title" className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="ra-title" className="text-base font-semibold text-fg">
              {pending.action === 'remind' ? 'שליחת תזכורת' : pending.action === 'resend' ? 'שליחה חוזרת' : pending.action === 'renew' ? 'חידוש קישור לחתימה' : 'שליחת עותק חתום'}
            </h3>
            <p className="mt-2 text-sm text-fg">{pending.plan ? pending.plan.summary : 'בודק מי מתאים לפעולה…'}</p>
            {pending.plan && pending.plan.eligible.length > 0 && pending.action !== 'send_signed_copy' ? (
              <div className="mt-3 flex gap-4 text-sm">
                {(['sms', 'email'] as const).map((c) => (
                  <label key={c} className="inline-flex items-center gap-2 text-fg">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={pending.channels.includes(c)}
                      onChange={(e) => setPending({ ...pending, channels: e.target.checked ? [...pending.channels, c] : pending.channels.filter((x) => x !== c) })}
                    />
                    {c === 'sms' ? 'SMS' : 'אימייל'}
                  </label>
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              {pending.action === 'remind' ? 'נוסח התזכורת של הקמפיין, עם קישור חתימה אישי חדש.' : pending.action === 'resend' ? 'ההודעה המקורית נשלחת שוב, עם קישור חתימה אישי חדש.' : pending.action === 'renew' ? 'קישור חדש עם תוקף חדש לפי הגדרות הקמפיין; המסמך חוזר להמתין לחתימה. נרשם ב-Audit.' : 'אישור החתימה עם כפתור מאובטח להורדת המסמך.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPending(null)} className={buttonClass}>
                ביטול
              </button>
              <button type="button" disabled={busy || !pending.plan || pending.plan.eligible.length === 0 || pending.channels.length === 0} onClick={() => void confirm()} className={primaryClass}>
                {busy ? 'שולח…' : `שלח (${pending.plan?.eligible.length ?? 0})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function RegistrationDrawer({
  projectId,
  id,
  linkingNeeded,
  task,
  onTaskSaved,
  onClose,
  onAct,
  onShare,
}: {
  projectId: string
  id: string | null
  linkingNeeded: boolean
  task: TaskSummary | null
  onTaskSaved: (task: TaskSummary) => void
  onClose: () => void
  onAct: (action: RegistrationAction, id: string) => void
  onShare: (id: string, via: 'whatsapp' | 'copy') => void
}) {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setDetail(null)
    setError(null)
    const controller = new AbortController()
    fetch(`/api/projects/${projectId}/registrations/${id}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) throw new Error(data?.error?.message ?? 'לא הצלחנו לטעון את הפרטים.')
        setDetail(data as RegistrationDetail)
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'לא הצלחנו לטעון את הפרטים.')
      })
    return () => controller.abort()
  }, [id, projectId])

  const dl = (rows: { label: string; value: string | null | undefined; dir?: 'ltr' }[]) => (
    <dl className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted">{r.label}</dt>
            <dd className="min-w-0 break-words text-fg" dir={r.dir}>{r.value}</dd>
          </div>
        ))}
    </dl>
  )

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={detail ? detail.business.name || 'הרשמה' : 'הרשמה'}>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {!detail && !error ? <p className="text-sm text-muted">טוען…</p> : null}
      {detail ? (
        <div className="flex flex-col gap-5">
          {detail.actions.length > 0 || detail.shareable ? (
            <div className="flex flex-wrap gap-2">
              {detail.actions.includes('remind') ? <button type="button" onClick={() => onAct('remind', detail.id)} className={primaryClass}>שלח תזכורת</button> : null}
              {detail.actions.includes('resend') ? <button type="button" onClick={() => onAct('resend', detail.id)} className={buttonClass}>שלח שוב</button> : null}
              {detail.actions.includes('renew') ? <button type="button" onClick={() => onAct('renew', detail.id)} className={primaryClass}>חדש קישור לחתימה</button> : null}
              {detail.actions.includes('send_signed_copy') ? <button type="button" onClick={() => onAct('send_signed_copy', detail.id)} className={buttonClass}>שלח עותק במייל</button> : null}
              {detail.shareable ? <button type="button" onClick={() => onShare(detail.id, 'whatsapp')} className={buttonClass}>שתף ב-WhatsApp</button> : null}
              {detail.shareable ? <button type="button" onClick={() => onShare(detail.id, 'copy')} className={buttonClass}>העתק קישור</button> : null}
            </div>
          ) : null}

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">פרטי העסק</h4>
            {dl([
              { label: 'שם', value: detail.business.name },
              { label: 'ח.פ.', value: detail.business.taxId, dir: 'ltr' },
              { label: 'איש קשר', value: detail.business.contactName },
              { label: 'תפקיד', value: detail.business.role },
              { label: 'טלפון', value: detail.business.phone, dir: 'ltr' },
              { label: 'אימייל', value: detail.business.email, dir: 'ltr' },
            ])}
            {detail.business.companyId ? (
              <Link href={`/companies/${detail.business.companyId}`} className="mt-2 inline-block text-xs text-brand hover:underline">
                פתח את הספק ←
              </Link>
            ) : null}
          </section>

          {linkingNeeded || !detail.business.companyId ? (
            <div>
              {linkingNeeded ? (
                <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  ההרשמה נשמרה מקומית כי ב-CRM לא נמצאה חברה אחת עם אותו ח.פ. בדקו למי היא שייכת וקשרו אותה, או השאירו אותה כרשומה מקומית.
                </p>
              ) : null}
              <LinkCompanyPanel leadId={detail.id} title="שיוך לספק/לקוח" onDone={() => window.location.reload()} onError={(m) => setError(m)} />
            </div>
          ) : null}

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">ההרשמה</h4>
            {dl([
              { label: 'תאריך ושעה', value: longDateTime.format(new Date(detail.submission.registeredAt)) },
              { label: 'מקור', value: detail.submission.source },
              { label: 'קמפיין', value: detail.submission.campaign },
              { label: 'UTM', value: Object.entries(detail.submission.utm).map(([k, v]) => `${k.replace('utm_', '')}=${v}`).join(' · ') || null, dir: 'ltr' },
              { label: 'Referrer', value: detail.submission.referrer, dir: 'ltr' },
            ])}
            {detail.submission.fields.length > 0 ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs text-muted">כל שדות הטופס ({detail.submission.fields.length})</summary>
                <div className="mt-2">{dl(detail.submission.fields.map((f) => ({ label: f.label, value: f.value })))}</div>
              </details>
            ) : null}
          </section>

          {detail.agreement ? (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">ההסכם</h4>
              {dl([
                { label: 'שם ההסכם', value: detail.agreement.title },
                { label: 'סטטוס', value: detail.agreement.statusLabel },
                { label: 'נשלח', value: detail.agreement.sentAt ? longDateTime.format(new Date(detail.agreement.sentAt)) : null },
                { label: 'נצפה', value: detail.agreement.viewedAt ? longDateTime.format(new Date(detail.agreement.viewedAt)) : null },
                { label: 'נחתם', value: detail.agreement.signedAt ? longDateTime.format(new Date(detail.agreement.signedAt)) : null },
                { label: 'תוקף הקישור', value: detail.agreement.expiresAt ? longDateTime.format(new Date(detail.agreement.expiresAt)) : null },
                { label: 'מהרשמה לחתימה', value: detail.agreement.timeToSign },
              ])}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <Link href={`/documents/${detail.agreement.id}`} className="text-brand hover:underline">
                  פתח את ההסכם ←
                </Link>
                {detail.agreement.status === 'signed' ? (
                  <a href={`/api/documents/${detail.agreement.id}/download`} className="text-brand hover:underline">
                    הורדת המסמך החתום
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {task ? (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">הקמת מוצר באתר</h4>
              <TaskPanel key={task.id} projectId={projectId} task={task} onSaved={onTaskSaved} />
            </section>
          ) : null}

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">פעילות</h4>
            <ol className="relative ms-2 border-s border-line ps-4 text-sm">
              {detail.timeline.map((e, i) => (
                <li key={`${e.type}-${e.at}-${i}`} className="relative pb-3 last:pb-0">
                  <span className={`absolute -start-[21px] top-1.5 size-2.5 rounded-full ${e.type.endsWith('_failed') ? 'bg-red-500' : e.type === 'completed' || e.type === 'signature_applied' ? 'bg-green-600' : 'bg-line'}`} aria-hidden="true" />
                  <span className="text-fg">{TIMELINE_LABELS[e.type] ?? e.type}</span>
                  {e.detail ? <span className="text-muted"> · {e.detail}</span> : null}
                  <span className="block text-xs text-muted">{longDateTime.format(new Date(e.at))}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
