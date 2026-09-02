'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CrmTemplate } from '@/server/crm/import-templates'

/**
 * Bring Fireberry print templates into XTRA Sign — the operator picks which.
 *
 * Read-only against the CRM, and a snapshot once here: a template already
 * imported is refused unless its content actually changed, in which case it
 * arrives as a new version beside the old one rather than replacing it. Fields
 * are placed afterwards, in the editor, like on any other template.
 */
export function CrmTemplateImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<CrmTemplate[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function openAndLoad() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setResult(null)
    setChosen(new Set())
    try {
      const response = await fetch('/api/crm/templates')
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו לקרוא את רשימת התבניות.')
        return
      }
      setTemplates(data.templates ?? [])
    } catch {
      setError('לא הצלחנו לקרוא את רשימת התבניות. בדקו את החיבור לאינטרנט.')
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function importChosen() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/crm/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateIds: [...chosen] }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הייבוא נכשל.')
        return
      }
      const parts = [`יובאו ${data.imported}`]
      if (data.skipped) parts.push(`ללא שינוי ${data.skipped}`)
      if (data.failed?.length) {
        parts.push(
          `נכשלו ${data.failed.length}: ` +
            data.failed.map((f: { name: string; reason: string }) => `${f.name} — ${f.reason}`).join(', '),
        )
      }
      setResult(parts.join(' · '))
      setChosen(new Set())
      await openAndLoadQuietly()
      router.refresh()
    } catch {
      setError('הייבוא נכשל. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  /** Refreshes the list after an import without clearing the result message. */
  async function openAndLoadQuietly() {
    try {
      const response = await fetch('/api/crm/templates')
      const data = await response.json().catch(() => null)
      if (response.ok) setTemplates(data.templates ?? [])
    } catch {
      // The result message already said what happened; a stale list is not worth an error.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openAndLoad}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        ייבוא תבניות מ-Fireberry
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">ייבוא תבניות מ-Fireberry</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-bg"
            aria-label="סגירה"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">טוען תבניות מ-Fireberry…</p>
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">לא נמצאו תבניות הדפסה ב-Fireberry.</p>
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((template) => {
                const selectable = !template.imported || template.updateAvailable
                return (
                  <li key={template.id}>
                    <label
                      className={`flex min-h-16 items-center gap-3 py-2 ${selectable ? 'cursor-pointer' : 'opacity-60'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-5 shrink-0"
                        disabled={!selectable}
                        checked={chosen.has(template.id)}
                        onChange={() => toggle(template.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{template.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {[
                            template.boundObject,
                            template.modifiedOn ? `עודכן ${template.modifiedOn.slice(0, 10)}` : null,
                            template.versions > 0 ? `${template.versions} גרסאות אצלנו` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {template.updateAvailable ? (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          קיימת גרסה חדשה
                        </span>
                      ) : template.imported ? (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          כבר יובא
                        </span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {result ? (
            <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-fg">{result}</p>
          ) : null}
        </div>

        <div className="flex min-h-16 items-center justify-between gap-3 border-t border-line px-4">
          <p className="text-xs text-muted">
            הייבוא לא משנה דבר ב-Fireberry. תבנית שיובאה לא משתנה אם התבנית ב-CRM תשתנה.
          </p>
          <button
            type="button"
            disabled={busy || chosen.size === 0}
            onClick={importChosen}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'מייבא…' : `ייבוא (${chosen.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
