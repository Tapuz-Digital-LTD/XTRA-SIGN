'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { normalizeSlug, validateSlug } from '@/lib/public-slug'
import { skinByKey } from '@/lib/self-service-skins'
import type { SelfServiceConfig } from '@/server/projects/self-service'
import { AgreementPanel, type ActiveAgreement } from './AgreementPanel'

/**
 * "הרשמה וחתימה עצמאית" — the project's second door (ADR 0001).
 *
 * What a person sees is their campaign page: its address, with open / copy /
 * change; the agreement registrants sign; who owns the agreements; how long
 * a link lives; what the thank-you page says. The page itself is code bound
 * to the project by a developer — there is no list of pages to pick from,
 * because there is nothing a person could create there.
 */

export type TemplateOption = { id: string; name: string; fieldCount: number }
export type OwnerOption = { id: string; name: string; email: string }
export type PublicSlugView = { current: string | null; history: { slug: string; replacedAt: string | null }[] }

const inputClass =
  'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'

export function SelfServiceSettings({
  projectId,
  config,
  publicSlug,
  publicBase,
  agreement,
  owners,
  currentUserId,
}: {
  projectId: string
  config: SelfServiceConfig
  publicSlug: PublicSlugView
  /** The origin links are minted on — the same one the SMS carries. */
  publicBase: string
  /** The agreement currently bound, or null. */
  agreement: ActiveAgreement | null
  /** Empty when the viewer may not list users; the current owner is then shown read-only. */
  owners: OwnerOption[]
  currentUserId: string
}) {
  const router = useRouter()
  const skin = skinByKey(config.skin)
  const [enabled, setEnabled] = useState(config.enabled)
  const [templateId, setTemplateId] = useState(config.templateId ?? '')
  const [ownerUserId, setOwnerUserId] = useState(config.ownerUserId ?? currentUserId)
  const [thankYouTitle, setThankYouTitle] = useState(config.thankYouTitle)
  const [thankYouText, setThankYouText] = useState(config.thankYouText)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const ready = Boolean(skin && templateId && ownerUserId)

  async function save(overrides: Partial<{ enabled: boolean; templateId: string }> = {}) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/self-service`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: overrides.enabled ?? enabled,
          templateId: (overrides.templateId ?? templateId) || null,
          ownerUserId: ownerUserId || null,
          thankYouTitle,
          thankYouText,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return false
      }
      setEnabled(Boolean(data.enabled))
      setMessage({ tone: 'ok', text: data.enabled ? 'ההרשמה העצמאית פעילה.' : 'ההגדרות נשמרו.' })
      router.refresh()
      return true
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
      return false
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
            ספק נכנס לעמוד הקמפיין, ממלא פרטים, קורא את ההסכם, מאמת טלפון וחותם — בלי שלב ידני. הספק, ההסכם
            והחתימה נוצרים אוטומטית בפרויקט הזה.
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

      {skin ? (
        <CampaignAddress projectId={projectId} publicBase={publicBase} initial={publicSlug} enabled={config.enabled} />
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-bg px-4 py-3 text-sm text-muted">
          לפרויקט הזה עדיין לא חובר עמוד קמפיין. עמוד קמפיין נבנה ומחובר לפרויקט על ידי צוות הפיתוח.
        </p>
      )}

      <AgreementPanel
        agreement={agreement}
        projectId={projectId}
        onActivate={async (id) => {
          setTemplateId(id)
          return save({ templateId: id })
        }}
      />

      <label className="mt-4 block text-sm">
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
          כדי להפעיל: {skin ? '' : 'לחבר עמוד קמפיין, '}להגדיר הסכם לחתימה ולבחור בעלים.
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

/**
 * The campaign page's address: the link as it is, and a way to change it
 * that says what changing it means — the old address keeps working.
 */
function CampaignAddress({
  projectId,
  publicBase,
  initial,
  enabled,
}: {
  projectId: string
  publicBase: string
  initial: PublicSlugView
  enabled: boolean
}) {
  const [slug, setSlug] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const url = slug.current ? `${publicBase}/${slug.current}` : null
  const check = draft ? validateSlug(draft) : null
  const preview = draft ? `${publicBase}/${normalizeSlug(draft) || '…'}` : null

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('העתיקו את הקישור:', url)
    }
  }

  async function saveSlug() {
    if (!check?.ok) return
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/public-slug`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: draft }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setNote({ tone: 'error', text: data?.error?.message ?? 'שינוי הכתובת נכשל.' })
        return
      }
      setSlug(data)
      setEditing(false)
      setDraft('')
      setNote({ tone: 'ok', text: 'הכתובת עודכנה. הכתובת הקודמת ממשיכה לעבוד ומפנה לכתובת החדשה.' })
    } catch {
      setNote({ tone: 'error', text: 'שינוי הכתובת נכשל. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">עמוד הקמפיין</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            enabled ? 'bg-green-50 text-green-800' : 'bg-line text-muted'
          }`}
        >
          {enabled ? 'פעיל' : 'לא פעיל'}
        </span>
      </div>

      {url ? (
        <p className="mt-2 break-all rounded-md bg-surface px-3 py-2 text-sm text-fg" dir="ltr">
          {url}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">הכתובת תיקבע כשההרשמה העצמאית תופעל.</p>
      )}

      {url ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={url} target="_blank" rel="noreferrer" className={buttonClass}>
            פתח עמוד
          </a>
          <button type="button" onClick={() => void copy()} className={buttonClass}>
            {copied ? 'הועתק' : 'העתק קישור'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v)
              setDraft(slug.current ?? '')
              setNote(null)
            }}
            className={buttonClass}
            aria-expanded={editing}
          >
            שינוי כתובת
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <label className="block text-sm">
            <span className="text-muted">כתובת חדשה</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
              aria-invalid={Boolean(check && !check.ok)}
              aria-describedby="slug-preview"
            />
          </label>
          <p id="slug-preview" className="mt-2 break-all text-xs text-muted" dir="ltr">
            {preview ?? ' '}
          </p>
          {check && !check.ok ? (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {check.message}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted">הכתובת הישנה תמשיך לעבוד ותפנה אוטומטית לכתובת החדשה.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !check?.ok || normalizeSlug(draft) === slug.current}
              onClick={() => void saveSlug()}
              className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמירת הכתובת'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
              ביטול
            </button>
          </div>
        </div>
      ) : null}

      {note ? (
        <p
          role={note.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            note.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {note.text}
        </p>
      ) : null}

      {slug.history.length > 0 ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">כתובות קודמות ({slug.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {slug.history.map((h) => (
              <li key={h.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-1.5">
                <span className="break-all text-fg" dir="ltr">
                  {publicBase}/{h.slug}
                </span>
                <span className="text-xs text-muted">
                  {h.replacedAt ? `עד ${new Date(h.replacedAt).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
