'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PROJECT_EVENTS, type ProjectNotificationSettings } from '@/lib/project-notifications'

/**
 * "התראות" — where the project's news goes and which news, plus the one
 * email the signer gets. Plain words, no event names; everything on by
 * default so a new campaign needs none of this.
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

  function addEmail() {
    const value = draft.trim().toLowerCase()
    if (!value) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
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
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">התראות</h2>
      <p className="mt-1 text-sm text-muted">לאן לשלוח התראות על הקמפיין הזה, בנוסף לכתובות שבהגדרות ההתראות הכלליות.</p>

      <div className="mt-4">
        <p className="text-sm font-medium text-fg">לאן לשלוח התראות?</p>
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
        <p className="text-sm font-medium text-fg">על מה להודיע?</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {PROJECT_EVENTS.map((e) => (
            <li key={e.key}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="checkbox" className="size-4" checked={events[e.key]} onChange={(ev) => setEvents({ ...events, [e.key]: ev.target.checked })} />
                {e.label}
                {!e.immediate ? <span className="text-xs text-muted">(בדוח היומי)</span> : null}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-lg border border-line bg-bg p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input type="checkbox" className="size-4" checked={signerCopy.enabled} onChange={(e) => setSignerCopy({ ...signerCopy, enabled: e.target.checked })} />
          שלח לחותם עותק לאחר חתימה
        </label>
        <p className="mt-1 text-xs text-muted">אימייל אישור עם כפתור מאובטח להורדת המסמך החתום. הקישור תקף למסמך הזה בלבד.</p>
        {signerCopy.enabled ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">שם השולח (רשות)</span>
              <input value={signerCopy.senderName ?? ''} onChange={(e) => setSignerCopy({ ...signerCopy, senderName: e.target.value || null })} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Reply-to (רשות)</span>
              <input
                value={signerCopy.replyTo ?? ''}
                onChange={(e) => setSignerCopy({ ...signerCopy, replyTo: e.target.value || null })}
                type="email"
                dir="ltr"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-muted">כתובת שמאושרת בחשבון השליחה.</span>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">משפט קצר משלכם (רשות)</span>
              <input value={signerCopy.note ?? ''} onChange={(e) => setSignerCopy({ ...signerCopy, note: e.target.value || null })} maxLength={300} className={inputClass} />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg sm:col-span-2">
              <input type="checkbox" className="size-4" checked={signerCopy.attachPdf} onChange={(e) => setSignerCopy({ ...signerCopy, attachPdf: e.target.checked })} />
              צרף גם את המסמך החתום למייל
              <span className="text-xs text-muted">(הכפתור המאובטח נשלח תמיד)</span>
            </label>
          </div>
        ) : null}
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמירת ההתראות'}
        </button>
      </div>
    </section>
  )
}
