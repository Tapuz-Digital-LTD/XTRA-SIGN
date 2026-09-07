'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ENTRY_METHODS, GOALS, hasForm, type CampaignGoal, type CampaignKind, type EntryMethod } from '@/lib/campaigns'

/**
 * The campaign itself: what kind it is, when it runs, whether registrations
 * stay open after the end, how long a signing link lives, who owns it, and
 * which agreement it sends by default. One card, one save.
 */

export type CampaignSettingsValue = {
  campaignKind: CampaignKind
  goal: CampaignGoal
  entry: EntryMethod
  startsAt: string | null
  endsAt: string | null
  registrationsAfterEnd: boolean
  linkTtlDays: number
  ownerUserId: string | null
  defaultTemplateId: string | null
}

const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function CampaignSettings({
  projectId,
  value,
  owners,
  templates,
}: {
  projectId: string
  value: CampaignSettingsValue
  owners: { id: string; name: string; email: string }[]
  templates: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [goal, setGoal] = useState<CampaignGoal>(value.goal)
  const [entry, setEntry] = useState<EntryMethod>(value.entry)
  const [startsAt, setStartsAt] = useState(value.startsAt?.slice(0, 10) ?? '')
  const [endsAt, setEndsAt] = useState(value.endsAt?.slice(0, 10) ?? '')
  const [afterEnd, setAfterEnd] = useState(value.registrationsAfterEnd)
  const [ttl, setTtl] = useState(String(value.linkTtlDays))
  const [owner, setOwner] = useState(value.ownerUserId ?? '')
  const [template, setTemplate] = useState(value.defaultTemplateId ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/campaign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal,
          entryMethod: entry,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          registrationsAfterEnd: afterEnd,
          linkTtlDays: Number(ttl) || 30,
          ownerUserId: owner || null,
          defaultTemplateId: template || null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setMessage({ tone: 'ok', text: 'הגדרות הקמפיין נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">הקמפיין</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">מה הקמפיין עושה</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value as CampaignGoal)} className={input}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">איך אנשים נכנסים</span>
          <select value={entry} onChange={(e) => setEntry(e.target.value as EntryMethod)} className={input}>
            {ENTRY_METHODS.filter((m) => m.goals.includes(goal)).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">שינוי כאן משנה רק את המסלול והלשוניות. הרשמות והסכמים שכבר נוצרו נשארים כפי שהם.</span>
        </label>
        <label className="block text-sm">
          <span className="text-muted">בעלים</span>
          {owners.length > 0 ? (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={input}>
              <option value="">— ללא —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.email}
                </option>
              ))}
            </select>
          ) : (
            <input value={owner ? 'המשתמש שנבחר' : 'לא נבחר'} readOnly className={input} />
          )}
        </label>
        <label className="block text-sm">
          <span className="text-muted">תאריך התחלה</span>
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-muted">תאריך סיום</span>
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} min={startsAt || undefined} className={input} />
        </label>
        {hasForm(entry) ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg sm:col-span-2">
            <input type="checkbox" className="size-4" checked={afterEnd} onChange={(e) => setAfterEnd(e.target.checked)} />
            אפשר הרשמות גם לאחר תאריך הסיום
            <span className="text-xs text-muted">(בלי זה העמוד מציג "ההרשמה לקמפיין הסתיימה" מתאריך הסיום)</span>
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="text-muted">תוקף קישור לחתימה (ימים)</span>
          <input type="number" min={1} max={365} value={ttl} onChange={(e) => setTtl(e.target.value)} className={input} />
          <span className="mt-1 block text-xs text-muted">חל על כל הסכם שהקמפיין שולח. תזכורת או שליחה חוזרת אינן מאריכות תוקף; חידוש קישור הוא פעולה מפורשת.</span>
        </label>
        <label className="block text-sm">
          <span className="text-muted">הסכם ברירת מחדל לשליחה</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className={input}>
            <option value="">— לבחור בכל שליחה —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-4 py-3 text-sm ${message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
          {message.text}
        </p>
      ) : null}
      <div className="mt-4">
        <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמירת הקמפיין'}
        </button>
      </div>
    </section>
  )
}
