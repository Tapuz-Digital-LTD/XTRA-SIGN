'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FormBuilder } from '@/components/projects/FormBuilder'
import { PublishPanel } from '@/components/projects/PublishPanel'
import type { LandingSettings } from '@/server/projects/landing'
import type { FormField } from '@/server/projects/form-schema'

/**
 * A project's own settings: the joining form and its builder, where the form
 * is published (hosted / embed / API), who hears about new leads, and the
 * project's name. Saved as a whole — one form, one button.
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
  const [fields, setFields] = useState<FormField[]>(landing.config.fields)
  const [allowedOrigins, setAllowedOrigins] = useState(landing.config.allowedOrigins.join('\n'))
  const [notifyEmails, setNotifyEmails] = useState(landing.notifyEmails.join('\n'))
  const [url, setUrl] = useState(landing.url)
  const [slug, setSlug] = useState(landing.slug)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

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
          config: {
            title,
            description: about,
            successMessage,
            fields,
            allowedOrigins: allowedOrigins
              .split(/[\n,]/)
              .map((o) => o.trim())
              .filter(Boolean),
          },
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
      setSlug(data.slug ?? null)
      if (data.config?.fields) setFields(data.config.fields)
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
    <div className="flex max-w-3xl flex-col gap-6">
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

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-fg">שדות הטופס</h3>
          <p className="mt-0.5 text-xs text-muted">
            שדות פרטי הספק ממלאים את כרטיס הספק אוטומטית כשמאשרים ליד; שדות מותאמים נשמרים עם הליד.
          </p>
          <div className="mt-3">
            <FormBuilder fields={fields} onChange={setFields} />
          </div>
        </div>
      </section>

      {slug && url ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-fg">פרסום והטמעה</h2>
          <p className="mt-1 text-sm text-muted">
            אותו טופס, שלוש דרכים: הקישור שלמעלה, הטמעה באתר חיצוני, או שליחה ישירה מהאתר שלכם.
          </p>
          <div className="mt-3">
            <PublishPanel
              slug={slug}
              url={url}
              fields={fields}
              allowedOrigins={allowedOrigins}
              onOriginsChange={setAllowedOrigins}
            />
          </div>
        </section>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">
          אפשרויות ההטמעה וה-API יופיעו אחרי השמירה הראשונה של הטופס.
        </p>
      )}

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
