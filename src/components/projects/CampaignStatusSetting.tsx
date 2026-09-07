'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CAMPAIGN_STATUSES, DEFAULT_ENDED_TEXT, type CampaignStatus } from '@/lib/campaigns'

/**
 * "סטטוס הקמפיין": open, paused, ended — by hand, any time, both ways.
 * Ending closes new registrations only: agreements already out stay
 * signable (unless the admin says otherwise) and signed documents stay
 * downloadable. The end page has its own words and a preview.
 */
const input = 'mt-1 w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg outline-none focus:border-brand'

export function CampaignStatusSetting({ projectId, value, publicUrl, isAdmin }: { projectId: string; value: { status: CampaignStatus; endedMessage: string; allowCompletionAfterEnd: boolean }; publicUrl: string | null; isAdmin: boolean }) {
  const router = useRouter()
  const [status, setStatus] = useState<CampaignStatus>(value.status)
  const [message, setMessage] = useState(value.endedMessage)
  const [allowCompletion, setAllowCompletion] = useState(value.allowCompletionAfterEnd)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function save(patch: Partial<{ status: CampaignStatus; endedMessage: string; allowCompletionAfterEnd: boolean }>) {
    setBusy(true)
    setMsg(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/campaign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMsg({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return false
      }
      setMsg({ tone: 'ok', text: 'נשמר.' })
      router.refresh()
      return true
    } catch {
      setMsg({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">סטטוס הקמפיין</h2>
      <p className="mt-1 text-sm text-muted">אפשר לסגור ולפתוח מחדש בכל רגע. סגירה עוצרת הרשמות חדשות בלבד; מסמכים חתומים נשארים זמינים.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="סטטוס הקמפיין">
        {CAMPAIGN_STATUSES.map((s) => (
          <label key={s.key} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ${status === s.key ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`}>
            <input type="radio" name="campaign-status" className="mt-1 size-4" checked={status === s.key} disabled={busy} onChange={async () => { const prev = status; setStatus(s.key); if (!(await save({ status: s.key }))) setStatus(prev) }} />
            <span>
              <span className="block text-base font-semibold text-fg">{s.label}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">{s.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-5">
        <label className="block text-sm">
          <span className="font-medium text-fg">הודעה לאחר סיום הקמפיין</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={600} placeholder={DEFAULT_ENDED_TEXT} className={input} />
          <span className="mt-1 block text-xs text-muted">מוצגת בעמוד הסיום במקום הטופס. ריק = הנוסח הכללי.</span>
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || message === value.endedMessage} onClick={() => void save({ endedMessage: message })} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">שמירת ההודעה</button>
          {publicUrl ? (
            <a href={`${publicUrl}?preview=ended`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">תצוגה מקדימה של עמוד הסיום</a>
          ) : null}
        </div>
      </div>

      {isAdmin ? (
        <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
          <input type="checkbox" className="mt-1 size-4" checked={allowCompletion} disabled={busy} onChange={async (e) => { const next = e.target.checked; setAllowCompletion(next); if (!(await save({ allowCompletionAfterEnd: next }))) setAllowCompletion(!next) }} />
          <span>
            <span className="block font-medium">מי שכבר נרשם יכול להשלים חתימה גם אחרי הסיום</span>
            <span className="block text-xs text-muted">ברירת המחדל. בלי זה, אחרי הסיום קישורי חתימה פתוחים מציגים את עמוד הסיום; מסמכים שכבר נחתמו נשארים זמינים בכל מקרה.</span>
          </span>
        </label>
      ) : null}

      {msg ? <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p> : null}
    </section>
  )
}
