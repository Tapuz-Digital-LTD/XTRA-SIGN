'use client'

import { useEffect, useState } from 'react'
import type { FieldMeta, ReportEntity, ReportRow } from '@/server/reports/engine/types'
import { Dialog } from './Dialog'
import { agreementIdOf, api, btnPrimary, btnSecondary, companyIdOf, fieldClass, leadIdOf, SELECT_ALL_CAP, taskIdOf, userLabel, type TagOption, type TeamUser } from './shared'

type ActionKey = 'remind' | 'assignee' | 'follow_up' | 'tags_add' | 'tags_remove' | 'add_company' | 'resend_failed' | 'task_status'

const LABELS: Record<ActionKey, string> = {
  remind: 'תזכורת',
  assignee: 'אחראי',
  follow_up: 'תאריך חזרה',
  tags_add: 'הוספת תגים',
  tags_remove: 'הסרת תגים',
  add_company: 'הוסף כספק/לקוח',
  resend_failed: 'שלח שוב הודעות שנכשלו',
  task_status: 'סטטוס משימה',
}

const INTROS: Record<ActionKey, string> = {
  remind: 'תזכורת תישלח למי שעדיין לא סיים, באותו ערוץ שבו הוזמן.',
  assignee: 'מי מטפל בפניות שנבחרו.',
  follow_up: 'מתי לחזור אליהם — הם יופיעו ב״לחזור אליהם היום״.',
  tags_add: 'התגים יתווספו לספק/ללקוח של כל שורה.',
  tags_remove: 'התגים יוסרו מהספק/מהלקוח של כל שורה.',
  add_company: 'לכל פנייה שעדיין אינה ספק או לקוח תיפתח רשומה חדשה.',
  resend_failed: 'ההודעה האחרונה שנכשלה תישלח שוב — SMS או אימייל.',
  task_status: 'אותו סטטוס לכל המשימות שנבחרו.',
}

const BY_ENTITY: Record<ReportEntity, ActionKey[]> = {
  people: ['remind', 'assignee', 'follow_up', 'tags_add', 'tags_remove', 'add_company'],
  agreements: ['remind', 'resend_failed'],
  suppliers: ['tags_add', 'tags_remove'],
  customers: ['tags_add', 'tags_remove'],
  tasks: ['task_status'],
  sends: [],
}

type Input = { userId?: string; date?: string; tagIds: string[]; kind: 'supplier' | 'customer'; status?: string }
type Plan = { eligible: number; skipped: Map<string, number>; exec: (input: Input) => Promise<string> }

const count = (skipped: Map<string, number>, why: string, n = 1) => skipped.set(why, (skipped.get(why) ?? 0) + n)

/** Rows bucketed by campaign, keeping only the ones that carry an id. */
function byGroup(rows: ReportRow[], idOf: (row: ReportRow) => string | undefined, skipped: Map<string, number>, missing: string): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const id = idOf(row)
    if (!id) count(skipped, missing)
    else if (!row.links.group) count(skipped, 'לא משויך לקמפיין')
    else groups.set(row.links.group, [...(groups.get(row.links.group) ?? []), id])
  }
  return groups
}

/** What the action would touch — counted on the server where it can be — and how to do it. */
async function plan(action: ActionKey, entity: ReportEntity, rows: ReportRow[]): Promise<Plan> {
  const skipped = new Map<string, number>()
  switch (action) {
    case 'remind': {
      const groups = byGroup(rows, (r) => leadIdOf(entity, r), skipped, 'אין הזמנה מקושרת')
      const eligible = new Map<string, string[]>()
      for (const [group, ids] of groups) {
        const preview = await api<{ eligible: { id: string }[]; skipped: { why: string }[] }>(`/api/projects/${group}/audience/remind`, { ids, dryRun: true })
        if (preview.eligible.length) eligible.set(group, preview.eligible.map((e) => e.id))
        for (const s of preview.skipped) count(skipped, s.why)
      }
      return {
        eligible: [...eligible.values()].reduce((n, ids) => n + ids.length, 0),
        skipped,
        exec: async () => {
          let sent = 0
          let failed = 0
          for (const [group, ids] of eligible) {
            const result = await api<{ sent: number; failed: unknown[] }>(`/api/projects/${group}/audience/remind`, { ids, dryRun: false })
            sent += result.sent
            failed += result.failed.length
          }
          return `נשלחו ${sent} תזכורות${failed ? ` · נכשלו ${failed}` : ''}.`
        },
      }
    }
    case 'resend_failed': {
      const agreementIds = rows.map((r) => agreementIdOf(entity, r)).filter((id): id is string => Boolean(id))
      count(skipped, 'אין הסכם', rows.length - agreementIds.length)
      const preview = agreementIds.length ? await api<{ eligible: number; skipped: { why: string }[] }>('/api/documents/bulk/resend-failed', { agreementIds, preview: true }) : { eligible: 0, skipped: [] }
      for (const s of preview.skipped) count(skipped, s.why)
      return {
        eligible: preview.eligible,
        skipped,
        exec: async () => {
          const result = await api<{ sent: number; failed: number }>('/api/documents/bulk/resend-failed', { agreementIds, preview: false })
          return `נשלחו שוב ${result.sent} הודעות${result.failed ? ` · נכשלו ${result.failed}` : ''}.`
        },
      }
    }
    case 'tags_add':
    case 'tags_remove': {
      const companyIds = [...new Set(rows.map((r) => companyIdOf(entity, r)).filter((id): id is string => Boolean(id)))]
      count(skipped, 'לא משויך לספק/לקוח', rows.filter((r) => !companyIdOf(entity, r)).length)
      const bulk = action === 'tags_add' ? 'add_tags' : 'remove_tags'
      const preview = companyIds.length ? await api<{ eligible: number }>('/api/companies/bulk', { action: bulk, companyIds, tagIds: [], preview: true }) : { eligible: 0 }
      if (companyIds.length > preview.eligible) count(skipped, 'הרשומה אינה זמינה', companyIds.length - preview.eligible)
      return {
        eligible: preview.eligible,
        skipped,
        exec: async (input) => {
          const result = await api<{ updated: number; skipped: number }>('/api/companies/bulk', { action: bulk, companyIds, tagIds: input.tagIds, preview: false })
          return `עודכנו ${result.updated} רשומות${result.skipped ? ` · ללא שינוי ${result.skipped}` : ''}.`
        },
      }
    }
    case 'assignee':
    case 'follow_up': {
      const ids = rows.map((r) => leadIdOf(entity, r)).filter((id): id is string => Boolean(id))
      count(skipped, 'אין הזמנה מקושרת', rows.length - ids.length)
      return {
        eligible: ids.length,
        skipped,
        exec: async (input) => {
          const body = action === 'assignee' ? { ids, assigneeUserId: input.userId } : { ids, followUpAt: input.date ? new Date(`${input.date}T09:00:00+03:00`).toISOString() : null }
          const result = await api<{ updated?: number }>('/api/invitations/bulk', body)
          return `עודכנו ${result.updated ?? ids.length} פניות.`
        },
      }
    }
    case 'add_company': {
      const ids: string[] = []
      for (const row of rows) {
        const lead = leadIdOf(entity, row)
        if (!lead) count(skipped, 'אין הזמנה מקושרת')
        else if (row.links.company) count(skipped, 'כבר משויך לספק/לקוח')
        else ids.push(lead)
      }
      return {
        eligible: ids.length,
        skipped,
        exec: async (input) => {
          let ok = 0
          let failed = 0
          // ponytail: one call per lead — the endpoint is per record; batch it server-side if hundreds become common.
          for (const lead of ids) {
            try {
              await api(`/api/invitations/${lead}/company`, { kind: input.kind })
              ok++
            } catch {
              failed++
            }
          }
          return `נוספו ${ok} רשומות${failed ? ` · נכשלו ${failed}` : ''}.`
        },
      }
    }
    case 'task_status': {
      const groups = byGroup(rows, (r) => taskIdOf(entity, r), skipped, 'אין משימה')
      return {
        eligible: [...groups.values()].reduce((n, ids) => n + ids.length, 0),
        skipped,
        exec: async (input) => {
          let updated = 0
          for (const [group, taskIds] of groups) {
            const result = await api<{ updated: number }>(`/api/projects/${group}/tasks/bulk`, { taskIds, status: input.status })
            updated += result.updated
          }
          return `עודכנו ${updated} משימות.`
        },
      }
    }
  }
}

const needsInput = (action: ActionKey, input: Input) =>
  action === 'assignee' ? Boolean(input.userId) : action === 'follow_up' ? Boolean(input.date) : action === 'tags_add' || action === 'tags_remove' ? input.tagIds.length > 0 : action === 'task_status' ? Boolean(input.status) : true

function ActionDialog({ action, entity, resolveRows, fields, team, onClose, onDone }: { action: ActionKey; entity: ReportEntity; resolveRows: (onProgress: (n: number) => void) => Promise<{ rows: ReportRow[]; capped: boolean }>; fields: FieldMeta[]; team: TeamUser[]; onClose: () => void; onDone: () => void }) {
  const [progress, setProgress] = useState<number | null>(null)
  const [capped, setCapped] = useState(false)
  const [planned, setPlanned] = useState<Plan | null>(null)
  const [tags, setTags] = useState<TagOption[]>([])
  const [input, setInput] = useState<Input>({ tagIds: [], kind: 'supplier', status: action === 'task_status' ? 'done' : undefined })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { rows, capped } = await resolveRows((n) => !cancelled && setProgress(n))
        if (cancelled) return
        setCapped(capped)
        setPlanned(await plan(action, entity, rows))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'לא הצלחנו לבדוק את הרשומות.')
      }
    })()
    if (action === 'tags_add' || action === 'tags_remove') {
      void fetch('/api/tags?kind=company')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => !cancelled && setTags(data?.tags ?? []))
    }
    return () => {
      cancelled = true
    }
    // The dialog is mounted per action and per selection; nothing it depends on changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirm() {
    if (!planned) return
    setBusy(true)
    setError(null)
    try {
      setResult(await planned.exec(input))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
    } finally {
      setBusy(false)
    }
  }

  const statusOptions = fields.find((f) => f.key === 'status')?.options ?? []
  const toggleTag = (id: string) => setInput((i) => ({ ...i, tagIds: i.tagIds.includes(id) ? i.tagIds.filter((t) => t !== id) : [...i.tagIds, id] }))

  return (
    <Dialog
      open
      onClose={onClose}
      title={LABELS[action]}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            {result ? 'סגירה' : 'ביטול'}
          </button>
          {!result ? (
            <button type="button" onClick={() => void confirm()} disabled={busy || !planned || planned.eligible === 0 || !needsInput(action, input)} className={btnPrimary}>
              {busy ? 'מבצע…' : planned ? `אישור (${planned.eligible})` : 'אישור'}
            </button>
          ) : null}
        </>
      }
    >
      <p className="text-sm text-muted">{INTROS[action]}</p>

      {action === 'assignee' ? (
        <label className="mt-3 block text-sm text-fg">
          אחראי
          <select value={input.userId ?? ''} onChange={(e) => setInput({ ...input, userId: e.target.value })} className={`${fieldClass} mt-1`}>
            <option value="">בחרו…</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {action === 'follow_up' ? (
        <label className="mt-3 block text-sm text-fg">
          תאריך חזרה
          <input type="date" value={input.date ?? ''} onChange={(e) => setInput({ ...input, date: e.target.value })} className={`${fieldClass} mt-1`} />
        </label>
      ) : null}
      {action === 'tags_add' || action === 'tags_remove' ? (
        <div role="group" aria-label="בחירת תגים" className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const on = input.tagIds.includes(tag.id)
            return (
              <button key={tag.id} type="button" aria-pressed={on} onClick={() => toggleTag(tag.id)} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm transition-colors ${on ? 'bg-brand text-white' : 'bg-bg text-fg hover:bg-slate-200'}`}>
                {on ? <span aria-hidden="true" className="me-1">✓</span> : null}
                <span className="max-w-48 truncate">{tag.name}</span>
              </button>
            )
          })}
          {tags.length === 0 ? <p className="text-sm text-muted">אין תגים עדיין.</p> : null}
        </div>
      ) : null}
      {action === 'add_company' ? (
        <label className="mt-3 block text-sm text-fg">
          להוסיף כ־
          <select value={input.kind} onChange={(e) => setInput({ ...input, kind: e.target.value === 'customer' ? 'customer' : 'supplier' })} className={`${fieldClass} mt-1`}>
            <option value="supplier">ספק</option>
            <option value="customer">לקוח</option>
          </select>
        </label>
      ) : null}
      {action === 'task_status' ? (
        <label className="mt-3 block text-sm text-fg">
          סטטוס
          <select value={input.status ?? ''} onChange={(e) => setInput({ ...input, status: e.target.value })} className={`${fieldClass} mt-1`}>
            <option value="">בחרו…</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'done' ? 'סמן כהוקם באתר' : o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mt-4 rounded-xl bg-bg p-3 text-sm" role="status">
        {!planned && !error ? (
          <p className="text-muted">{progress === null ? 'בודק…' : `אוסף רשומות… ${progress.toLocaleString('he-IL')}`}</p>
        ) : planned ? (
          <>
            <p className="font-semibold text-fg">יבוצע על {planned.eligible.toLocaleString('he-IL')} רשומות</p>
            {[...planned.skipped.entries()].map(([why, n]) => (
              <p key={why} className="text-muted">
                ידולגו {n.toLocaleString('he-IL')} — {why}
              </p>
            ))}
            {capped ? <p className="mt-1 text-amber-800">הבחירה הוגבלה ל־{SELECT_ALL_CAP.toLocaleString('he-IL')} הרשומות הראשונות. לשאר, צמצמו את הסינון.</p> : null}
          </>
        ) : null}
      </div>
      {result ? (
        <p role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {result}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/**
 * The bar that appears over a selection: what is selected, and the actions
 * this kind of row allows. Each action says what it will touch before it
 * does anything.
 */
export function BulkActionsBar({ entity, count: selectedCount, allMatching, resolveRows, fields, team, onDone, onClear }: { entity: ReportEntity; count: number; allMatching: boolean; resolveRows: (onProgress: (n: number) => void) => Promise<{ rows: ReportRow[]; capped: boolean }>; fields: FieldMeta[]; team: TeamUser[]; onDone: () => void; onClear: () => void }) {
  const [dialog, setDialog] = useState<ActionKey | null>(null)
  const actions = BY_ENTITY[entity]
  if (selectedCount === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand bg-blue-50/95 backdrop-blur" data-testid="bulk-bar">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <span className="text-sm font-semibold text-fg">
          נבחרו {selectedCount.toLocaleString('he-IL')}
          {allMatching ? ' (כל התואמים)' : ''}
        </span>
        {actions.map((action) => (
          <button key={action} type="button" onClick={() => setDialog(action)} className={btnSecondary}>
            {LABELS[action]}
          </button>
        ))}
        {actions.length === 0 ? <span className="text-sm text-muted">אין פעולות לסוג הזה — אפשר לייצא.</span> : null}
        <button type="button" onClick={onClear} className="ms-auto inline-flex min-h-11 items-center px-2 text-sm text-brand underline-offset-4 hover:underline">
          ביטול בחירה
        </button>
      </div>
      {dialog ? (
        <ActionDialog
          key={dialog}
          action={dialog}
          entity={entity}
          resolveRows={resolveRows}
          fields={fields}
          team={team}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
    </div>
  )
}
