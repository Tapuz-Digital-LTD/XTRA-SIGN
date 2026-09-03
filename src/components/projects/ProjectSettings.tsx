'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LandingSettings, LandingField } from '@/server/projects/landing'

/**
 * A project's own settings: the joining form, who hears about new leads, and
 * the project's name. Saved as a whole — one form, one button.
 */
export function ProjectSettings({
  projectId,
  projectName,
  projectDescription,
  landing,
}: {
  projectId: string
  projectName: string
  projectDescription: string | null
  landing: LandingSettings
}) {
  const router = useRouter()
  const [name, setName] = useState(projectName)
  const [description, setDescription] = useState(projectDescription ?? '')
  const [enabled, setEnabled] = useState(landing.enabled)
  const [title, setTitle] = useState(landing.config.title)
  const [about, setAbout] = useState(landing.config.description)
  const [successMessage, setSuccessMessage] = useState(landing.config.successMessage)
  const [fields, setFields] = useState<LandingField[]>(landing.config.fields)
  const [notifyEmails, setNotifyEmails] = useState(landing.notifyEmails.join('\n'))
  const [url, setUrl] = useState(landing.url)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function setRequired(key: string, required: boolean) {
    setFields((current) => current.map((f) => (f.key === key ? { ...f, required } : f)))
  }

  function addCustomField() {
    const label = window.prompt('שם השדה החדש (למשל: תחום עיסוק)')
    if (!label?.trim()) return
    const key = `custom_${Math.random().toString(36).slice(2, 8)}`
    setFields((current) => [...current, { key, label: label.trim(), required: false }])
  }

  function removeField(key: string) {
    if (key === 'name') return
    setFields((current) => current.filter((f) => f.key !== key))
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      // The project's name travels through the existing rename action; the
      // landing settings through their own endpoint. One button, two writes.
      if (name.trim() !== projectName || (description || null) !== (projectDescription ?? null)) {
        const renamed = await fetch(`/api/groups/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rename', name: name.trim(), description: description || null }),
        })
        if (!renamed.ok) {
          const data = await renamed.json().catch(() => null)
          setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
          return
        }
      }

      const response = await fetch(`/api/projects/${projectId}/landing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          config: { title, description: about, successMessage, fields },
          notifyEmails: notifyEmails
            .split(/[\n,]/)
            .map((e) => e.trim())
            .filter(Boolean),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setUrl(data.url ?? null)
      setMessage({ tone: 'ok', text: 'ההגדרות נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('למחוק את הפרויקט? הספקים וההסכמים עצמם יישארו במערכת.')) return
    setBusy(true)
    try {
      await fetch(`/api/groups/${projectId}`, { method: 'DELETE' })
      router.push('/projects')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">פרטי הפרויקט</h2>
        <label className="mt-3 block text-sm">
          <span className="text-muted">שם הפרויקט</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-muted">תיאור</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">טופס הצטרפות לספקים</h2>
            <p className="mt-1 text-sm text-muted">
              דף ציבורי שבו ספק משאיר פרטים. כל פנייה הופכת לליד שממתין לאישור שלכם.
            </p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5" />
            פעיל
          </label>
        </div>

        {url && enabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="ltr">
              {url}
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
              className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
            >
              {copied ? 'הועתק ✓' : 'העתקת קישור'}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
            >
              פתיחה
            </a>
          </div>
        ) : null}

        <label className="mt-4 block text-sm">
          <span className="text-muted">כותרת הטופס</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-muted">הסבר קצר</span>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={2}
            placeholder="למשל: מלאו פרטים ונחזור אליכם עם הסכם ההתקשרות."
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-muted">הודעת תודה אחרי שליחה</span>
          <input
            value={successMessage}
            onChange={(e) => setSuccessMessage(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>

        <div className="mt-4">
          <span className="text-sm text-muted">שדות הטופס</span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {fields.map((field) => (
              <li key={field.key} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3">
                <span className="min-w-0 truncate text-sm text-fg">{field.label}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => setRequired(field.key, e.target.checked)}
                      className="size-4"
                    />
                    חובה
                  </label>
                  {field.key !== 'name' ? (
                    <button
                      type="button"
                      onClick={() => removeField(field.key)}
                      className="text-xs text-red-700 hover:underline"
                    >
                      הסרה
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addCustomField}
            className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-dashed border-line bg-surface px-3 text-xs font-medium text-muted transition hover:border-brand hover:text-fg"
          >
            + שדה נוסף
          </button>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">התראות על לידים חדשים</h2>
        <p className="mt-1 text-sm text-muted">
          כתובות שיקבלו אימייל כשספק חדש משאיר פרטים בפרויקט הזה — בנוסף לכתובות שבהגדרות ההתראות הכלליות.
        </p>
        <textarea
          value={notifyEmails}
          onChange={(e) => setNotifyEmails(e.target.value)}
          rows={3}
          dir="ltr"
          placeholder={'one@example.com\ntwo@example.com'}
          className="mt-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </section>

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמירת ההגדרות'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-red-700 transition hover:border-red-400 disabled:opacity-50"
        >
          מחיקת הפרויקט
        </button>
      </div>
    </div>
  )
}
