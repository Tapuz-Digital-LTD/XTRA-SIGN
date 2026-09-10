'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Staff follow-up for one person: who handles it, when to call back, how the
 * call went, a private note. Shown in full while there is work left (the
 * caller decides: not signed, an open task, a due call-back, an owner); when
 * everything is done it folds into one green line with "הוסף מעקב" for the
 * next time someone needs to be called. Never a CRM — four fields.
 */
export type FollowUpValues = { assigneeUserId: string | null; assigneeName?: string | null; followUpAt: string | null; callOutcome: string | null; internalNote: string | null }

const OUTCOMES: { key: string; label: string }[] = [
  { key: 'interested', label: 'מעוניין' },
  { key: 'call_back', label: 'לחזור אליו' },
  { key: 'no_answer', label: 'לא ענה' },
  { key: 'not_interested', label: 'לא מעוניין' },
]
const field = 'mt-1 w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg outline-none focus:border-brand'

/** Is there still something to do for this person? The caller's facts, one answer. */
export function hasOpenWork(input: { signed: boolean; taskStatuses?: string[]; followUpAt?: string | null; assigneeUserId?: string | null; callOutcome?: string | null }): boolean {
  if (!input.signed) return true
  if ((input.taskStatuses ?? []).some((s) => s === 'pending' || s === 'in_progress')) return true
  if (input.assigneeUserId) return true
  if (input.callOutcome === 'call_back') return true
  if (input.followUpAt) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (new Date(input.followUpAt) >= today) return true
  }
  return false
}

export function FollowUpPanel({ leadId, values, openWork, doneText = 'ההצטרפות הושלמה.', onSaved, onError }: { leadId: string; values: FollowUpValues; openWork: boolean; doneText?: string; onSaved?: () => void; onError?: (message: string) => void }) {
  const router = useRouter()
  const [show, setShow] = useState(openWork)
  const [team, setTeam] = useState<{ id: string; name: string; email: string }[]>([])
  const [assignee, setAssignee] = useState(values.assigneeUserId ?? '')
  const [followUpAt, setFollowUpAt] = useState(values.followUpAt ? values.followUpAt.slice(0, 10) : '')
  const [callOutcome, setCallOutcome] = useState(values.callOutcome ?? '')
  const [note, setNote] = useState(values.internalNote ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!show) return
    let live = true
    void fetch('/api/team')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setTeam(Array.isArray(d?.users) ? d.users : []))
      .catch(() => live && setTeam([]))
    return () => {
      live = false
    }
  }, [show])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/invitations/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeUserId: assignee || null, followUpAt: followUpAt ? new Date(`${followUpAt}T09:00:00+03:00`).toISOString() : null, callOutcome: callOutcome || null, internalNote: note }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const text = data?.error?.message ?? 'השמירה נכשלה.'
        setMessage(text)
        onError?.(text)
        return
      }
      setMessage('נשמר.')
      onSaved?.()
      router.refresh()
    } catch {
      setMessage('השמירה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setSaving(false)
    }
  }

  if (!show) {
    return (
      <section className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm font-semibold text-green-900">{doneText}</p>
        <button type="button" onClick={() => setShow(true)} className="mt-2 text-sm font-medium text-brand underline">
          הוסף מעקב (אחראי, תאריך חזרה, הערה)
        </button>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-fg">מעקב</h3>
      <p className="mt-1 text-xs text-muted">מי מטפל, מתי לחזור, ומה סוכם בשיחה. נשמר ב-XTRA Sign בלבד.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">אחראי לטיפול</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
            <option value="">ללא</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">תאריך חזרה</span>
          <input type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className={field} />
        </label>
      </div>
      <div className="mt-3">
        <span className="text-sm text-muted">תוצאת השיחה</span>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OUTCOMES.map((o) => (
            <label key={o.key} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium ${callOutcome === o.key ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`}>
              <input type="radio" name={`call-outcome-${leadId}`} className="sr-only" checked={callOutcome === o.key} onChange={() => setCallOutcome(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-muted">הערה פנימית</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className={field} />
      </label>
      <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-4 text-base font-semibold text-white disabled:opacity-50">
        {saving ? 'שומרים…' : 'שמירת המעקב'}
      </button>
      {message ? (
        <p role="status" className={`mt-2 text-sm ${message === 'נשמר.' ? 'text-green-700' : 'text-red-700'}`}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
