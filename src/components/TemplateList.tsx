'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { TemplateListItem } from '@/server/templates/templates'

const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The templates, each with the one action that matters — a new document —
 * and, for whoever may manage it, rename and delete.
 */
export function TemplateList({ templates }: { templates: TemplateListItem[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  async function call(id: string, run: () => Promise<Response>, onOk: (data: Record<string, string>) => void) {
    setBusyId(id)
    setError(null)
    try {
      const response = await run()
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      onOk(data ?? {})
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusyId(null)
    }
  }

  const use = (id: string) =>
    call(
      id,
      () => fetch(`/api/templates/${id}/use`, { method: 'POST' }),
      (data) => router.push(`/documents/${data.agreementId}/edit`),
    )

  const remove = (template: TemplateListItem) => {
    if (!window.confirm(`למחוק את התבנית "${template.name}"? מסמכים שנוצרו ממנה לא יושפעו.`)) return
    void call(
      template.id,
      () => fetch(`/api/templates/${template.id}`, { method: 'DELETE' }),
      () => router.refresh(),
    )
  }

  const rename = (id: string, name: string) =>
    call(
      id,
      () =>
        fetch(`/api/templates/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      () => {
        setRenaming(null)
        router.refresh()
      },
    )

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {templates.map((template) => {
          const busy = busyId === template.id
          const details = [
            template.pageCount ? `${template.pageCount} עמודים` : null,
            template.signatureCount === 1
              ? 'חתימה אחת'
              : template.signatureCount > 1
                ? `${template.signatureCount} חתימות`
                : 'ללא חתימה',
            `${template.fieldCount} שדות`,
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <li key={template.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                {renaming?.id === template.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void rename(template.id, renaming.name)
                    }}
                  >
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: template.id, name: e.target.value })}
                      maxLength={120}
                      aria-label="שם התבנית"
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="min-h-11 rounded-lg bg-brand px-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      שמירה
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-fg"
                    >
                      ביטול
                    </button>
                  </form>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-fg">{template.name}</p>
                    <p className="truncate text-xs text-muted">
                      {details}
                      {template.createdByName ? ` · ${template.createdByName}` : ''}
                      {' · '}
                      <time dateTime={template.createdAt.toISOString()}>
                        {formatter.format(template.createdAt)}
                      </time>
                    </p>
                  </>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void use(template.id)}
                  className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                >
                  {busy ? 'יוצר…' : 'מסמך חדש מהתבנית'}
                </button>
                {template.canManage ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenaming({ id: template.id, name: template.name })}
                      className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm text-fg transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      שינוי שם
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(template)}
                      className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm text-danger transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      מחיקה
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
