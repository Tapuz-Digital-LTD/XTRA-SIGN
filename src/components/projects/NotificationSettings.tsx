'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PROJECT_EVENTS, type ProjectNotificationSettings } from '@/lib/project-notifications'
import { describeCron, REMINDER_CRON } from '@/lib/schedule'

/**
 * "התראות" — who on the team hears about the campaign, and when. Every
 * event says plainly whether it mails at once or rides the daily summary,
 * and the daily summary says its real hour (read from the deployed
 * schedule, in Israel time). The signer's own mail is a separate matter
 * and lives under "הודעות לנמענים".
 */

const inputClass = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function NotificationSettings({ projectId, settings: initial }: { projectId: string; settings: ProjectNotificationSettings }) {
  const router = useRouter()
  const [emails, setEmails] = useState(initial.emails)
  const [draft, setDraft] = useState('')
  const [events, setEvents] = useState(initial.events)
  const [signerCopy, setSignerCopy] = useState(initial.signerCopy)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const daily = describeCron(REMINDER_CRON)

  function addEmail() {
    const value = draft.trim().toLowerCase()
    if (!value) return
    if (!/^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
      setMessage({ tone: 'error', text: 'הכתובת אינה תקינה.' })
      return
    }
    if (!emails.includes(value)) setEmails([...emails, value])
    setDraft('')
    setMessage(null)
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/notifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, events, signerCopy }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setMessage({ tone: 'ok', text: 'הגדרות ההתראות נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">התראות לצוות</h2>
        <p className="mt-1 text-sm text-muted">מי מקבל עדכונים על הקמפיין הזה, ומתי. הכתובות כאן מצטרפות לכתובות שבהגדרות המערכת.</p>

        <div className="mt-4">
          <p className="text-sm font-medium text-fg">מי מקבל?</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {emails.map((e) => (
              <li key={e} className="inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-sm text-fg" dir="ltr">
                {e}
                <button type="button" onClick={() => setEmails(emails.filter((x) => x !== e))} aria-label={`הסרת ${e}`} className="text-muted hover:text-fg">
                  ✕
                </button>
              </li>
            ))}
            {emails.length === 0 ? <li className="text-sm text-muted">עדיין לא הוגדרו כתובות לקמפיין.</li> : null}
          </ul>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addEmail()
                }
              }}
              type="email"
              dir="ltr"
              placeholder="name@company.co.il"
              aria-label="כתובת אימייל להתראות"
              className="h-11 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
            />
            <button type="button" onClick={addEmail} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
              + הוסף כתובת
            </button>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium text-fg">על מה, ומתי?</p>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {PROJECT_EVENTS.map((e) => (
              <li key={e.key} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <input id={`ev-${e.key}`} type="checkbox" className="size-4 shrink-0" checked={events[e.key]} onChange={(ev) => setEvents({ ...events, [e.key]: ev.target.checked })} />
                <label htmlFor={`ev-${e.key}`} className="min-w-0 flex-1 cursor-pointer text-sm text-fg">{e.label}</label>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${e.immediate ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{e.immediate ? 'מיידי' : 'בסיכום היומי'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            הסיכום היומי יוצא {daily.sentence}. השעה נקבעת בלוח הזמנים של המערכת ואינה ניתנת לשינוי מכאן.
          </p>
        </div>

        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-4 py-3 text-sm ${message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
            {message.text}
          </p>
        ) : null}
        <div className="mt-4">
          <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'שומר…' : 'שמירת ההתראות'}
          </button>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">הודעות לנמענים</h2>
        <p className="mt-1 text-sm text-muted">
          מה הספק או הלקוח מקבל במהלך התהליך. הנוסחים עצמם נערכים בלשונית{' '}
          <Link href={`/projects/${projectId}?tab=settings&section=messages`} className="font-medium text-brand hover:underline">הודעות</Link>.
        </p>
        <div className="mt-3 rounded-lg border border-line bg-bg p-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
            <input type="checkbox" className="size-4" checked={signerCopy.enabled} onChange={(e) => setSignerCopy({ ...signerCopy, enabled: e.target.checked })} />
            אחרי חתימה — לשלוח לחותם אימייל עם כפתור להורדת המסמך החתום
          </label>
          <p className="mt-1 text-xs text-muted">נשלח מיד לאחר שה-PDF החתום נוצר. הכפתור מאובטח ותקף למסמך הזה בלבד.</p>
          {signerCopy.enabled ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted">שם השולח (רשות)</span>
                <input value={signerCopy.senderName ?? ''} onChange={(e) => setSignerCopy({ ...signerCopy, senderName: e.target.value || null })} className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-muted">כתובת למענה (רשות)</span>
                <input value={signerCopy.replyTo ?? ''} onChange={(e) => setSignerCopy({ ...signerCopy, replyTo: e.target.value || null })} type="email" dir="ltr" className={inputClass} />
                <span className="mt-1 block text-xs text-muted">כתובת שמאושרת בחשבון השליחה.</span>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-muted">משפט קצר משלכם (רשות)</span>
                <input value={signerCopy.note ?? ''} onChange={(e) => setSignerCopy({ ...signerCopy, note: e.target.value || null })} maxLength={300} className={inputClass} />
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg sm:col-span-2">
                <input type="checkbox" className="size-4" checked={signerCopy.attachPdf} onChange={(e) => setSignerCopy({ ...signerCopy, attachPdf: e.target.checked })} />
                לצרף גם את הקובץ למייל
                <span className="text-xs text-muted">(לא מומלץ; הכפתור המאובטח נשלח תמיד)</span>
              </label>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            נרשם שלא סיים לחתום באותו ביקור מקבל, כמה דקות אחר כך, הודעה עם קישור לחזור ולחתום. מי שחתם — לא.
          </p>
        </div>
      </section>
    </div>
  )
}
