'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { SELF_SERVICE_SKINS, skinByKey } from '@/lib/self-service-skins'
import type { SelfServiceConfig } from '@/server/projects/self-service'

/**
 * "הרשמה וחתימה עצמאית" — the project's second door (ADR 0001).
 *
 * Small on purpose: switch, which branded pages, which agreement, who owns
 * the agreements, how long a link lives, what the thank-you page says. The
 * pages themselves are code; everything a person would want to change about
 * the flow is here.
 */

export type TemplateOption = { id: string; name: string; fieldCount: number }
export type OwnerOption = { id: string; name: string; email: string }

const inputClass =
  'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function SelfServiceSettings({
  projectId,
  config,
  templates: initialTemplates,
  owners,
  currentUserId,
}: {
  projectId: string
  config: SelfServiceConfig
  templates: TemplateOption[]
  /** Empty when the viewer may not list users; the current owner is then shown read-only. */
  owners: OwnerOption[]
  currentUserId: string
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(config.enabled)
  const [skin, setSkin] = useState<string>(config.skin ?? SELF_SERVICE_SKINS[0].key)
  const [templateId, setTemplateId] = useState(config.templateId ?? '')
  const [ownerUserId, setOwnerUserId] = useState(config.ownerUserId ?? currentUserId)
  const [linkTtlDays, setLinkTtlDays] = useState(String(config.linkTtlDays))
  const [thankYouTitle, setThankYouTitle] = useState(config.thankYouTitle)
  const [thankYouText, setThankYouText] = useState(config.thankYouText)
  const [templates, setTemplates] = useState(initialTemplates)
  const [uploadName, setUploadName] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const chosenSkin = skinByKey(skin)
  const publicUrl =
    chosenSkin && typeof window !== 'undefined' ? `${window.location.origin}${chosenSkin.basePath}` : null
  const ready = Boolean(skin && templateId && ownerUserId)

  async function uploadTemplate() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setMessage({ tone: 'error', text: 'יש לבחור קובץ PDF.' })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('name', uploadName.trim() || file.name.replace(/\.pdf$/i, ''))
      const response = await fetch('/api/templates/from-pdf', { method: 'POST', body: form })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'ההעלאה נכשלה.' })
        return
      }
      const created: TemplateOption = {
        id: data.templateId,
        name: uploadName.trim() || file.name.replace(/\.pdf$/i, ''),
        fieldCount: data.fieldCount ?? 0,
      }
      setTemplates((list) => [created, ...list])
      setTemplateId(created.id)
      setUploadName('')
      if (fileRef.current) fileRef.current.value = ''
      setMessage({
        tone: 'ok',
        text:
          created.fieldCount > 0
            ? `ההסכם הועלה. זוהו ${created.fieldCount} שדות למילוי בקובץ.`
            : 'ההסכם הועלה. לא זוהו שדות למילוי — יש להציב שדות דרך מסמך מהתבנית.',
      })
    } catch {
      setMessage({ tone: 'error', text: 'ההעלאה נכשלה. נסו שוב.' })
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/self-service`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          skin,
          templateId: templateId || null,
          ownerUserId: ownerUserId || null,
          linkTtlDays: Number(linkTtlDays) || 30,
          thankYouTitle,
          thankYouText,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setEnabled(Boolean(data.enabled))
      setMessage({ tone: 'ok', text: data.enabled ? 'ההרשמה העצמאית פעילה.' : 'ההגדרות נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">הרשמה וחתימה עצמאית</h2>
          <p className="mt-1 text-sm text-muted">
            עמוד ציבורי ממותג שבו ספק ממלא פרטים, קורא את ההסכם, מאמת טלפון וחותם — בלי שלב ידני.
            הספק, ההסכם והחתימה נוצרים אוטומטית בפרויקט הזה.
          </p>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-5"
            disabled={!ready && !enabled}
          />
          פעיל
        </label>
      </div>

      {enabled && publicUrl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="ltr">
            {publicUrl}
          </span>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
          >
            פתיחה
          </a>
        </div>
      ) : null}

      <label className="mt-4 block text-sm">
        <span className="text-muted">עמוד ציבורי ממותג</span>
        <select value={skin} onChange={(e) => setSkin(e.target.value)} className={inputClass}>
          {SELF_SERVICE_SKINS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        <span className="text-muted">ההסכם לחתימה (תבנית)</span>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
          <option value="">— בחרו תבנית —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.fieldCount} שדות
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 rounded-lg border border-dashed border-line bg-bg p-3">
        <p className="text-xs font-medium text-fg">העלאת הסכם חדש (PDF)</p>
        <p className="mt-0.5 text-xs text-muted">
          PDF עם שדות למילוי מביא איתו את השדות; הם ימולאו אוטומטית מפרטי ההרשמה.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="שם התבנית"
            className="h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
          <input ref={fileRef} type="file" accept="application/pdf" className="h-11 flex-1 text-sm text-fg file:me-2 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-xs" />
          <button
            type="button"
            disabled={uploading}
            onClick={() => void uploadTemplate()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50"
          >
            {uploading ? 'מעלה…' : 'העלאה'}
          </button>
        </div>
      </div>

      <label className="mt-3 block text-sm">
        <span className="text-muted">בעלים של ההסכמים שנוצרים</span>
        {owners.length > 0 ? (
          <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={inputClass}>
            <option value="">— בחרו משתמש —</option>
            {owners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.email}
              </option>
            ))}
          </select>
        ) : (
          <input value={ownerUserId ? 'המשתמש שנבחר' : 'לא נבחר'} readOnly className={inputClass} />
        )}
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">תוקף קישור החתימה (ימים)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={linkTtlDays}
            onChange={(e) => setLinkTtlDays(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">כותרת עמוד התודה</span>
          <input value={thankYouTitle} onChange={(e) => setThankYouTitle(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-muted">טקסט נוסף בעמוד התודה (רשות)</span>
        <textarea
          value={thankYouText}
          onChange={(e) => setThankYouText(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
        />
      </label>

      {!ready ? (
        <p className="mt-3 text-xs text-muted">
          כדי להפעיל: לבחור עמוד ממותג, תבנית הסכם ובעלים.
        </p>
      ) : null}

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
          {busy ? 'שומר…' : 'שמירת ההרשמה העצמאית'}
        </button>
      </div>
    </section>
  )
}
