'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { NotificationPrefs } from '@/server/notifications/notifications'

/**
 * Which addresses hear about events, and which events speak.
 *
 * The immediate events mail the moment they happen; the two "digest" events
 * are folded into one daily morning email so an inbox is not sandpapered by
 * every document that is merely still waiting.
 */
const EVENTS: { key: string; label: string; timing: string }[] = [
  { key: 'signed', label: 'מסמך נחתם', timing: 'מיידי' },
  { key: 'new_lead', label: 'ליד חדש מטופס הצטרפות', timing: 'מיידי' },
  { key: 'send_failed', label: 'שליחה נכשלה', timing: 'מיידי' },
  { key: 'unsigned_digest', label: 'מסמכים שממתינים כמה ימים', timing: 'סיכום יומי' },
  { key: 'expiring_digest', label: 'קישורים שעומדים לפוג', timing: 'סיכום יומי' },
]

export function NotificationSettingsForm({ prefs }: { prefs: NotificationPrefs }) {
  const router = useRouter()
  const [emails, setEmails] = useState(prefs.emails.join('\n'))
  const [events, setEvents] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const event of EVENTS) initial[event.key] = prefs.events[event.key] !== false
    return initial
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: emails
            .split(/[\n,]/)
            .map((e) => e.trim())
            .filter(Boolean),
          events,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setMessage({ tone: 'ok', text: 'ההגדרות נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-5">
      <label className="block text-sm">
        <span className="font-medium text-fg">כתובות אימייל לקבלת התראות</span>
        <span className="mt-0.5 block text-xs text-muted">כתובת אחת בכל שורה. אפשר יותר מאחת.</span>
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          dir="ltr"
          placeholder={'office@example.com'}
          className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-fg">אילו אירועים שולחים אימייל</legend>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
          {EVENTS.map((event) => (
            <li key={event.key} className="flex min-h-12 items-center justify-between gap-3 px-4">
              <span className="text-sm text-fg">{event.label}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted">{event.timing}</span>
                <input
                  type="checkbox"
                  checked={events[event.key]}
                  onChange={(e) => setEvents((current) => ({ ...current, [event.key]: e.target.checked }))}
                  className="size-5"
                  aria-label={event.label}
                />
              </span>
            </li>
          ))}
        </ul>
      </fieldset>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-4 py-3 text-sm ${
            message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </form>
  )
}
