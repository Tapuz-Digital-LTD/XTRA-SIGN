'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { AgreementStatus } from '@/lib/status'

type Action = { label: string; run: () => unknown; danger?: boolean }

/**
 * The actions a document can actually take, given where it is.
 *
 * Only legal ones are rendered — nothing greyed out, nothing that explains
 * itself with an error after the click. A signed document has no edit and no
 * delete anywhere in this menu, because it has none anywhere in the system.
 */
export function RowActions({
  documentId,
  status,
  companyId,
  hasCompany,
}: {
  documentId: string
  status: AgreementStatus
  companyId: string | null
  hasCompany: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  async function call(url: string, init: RequestInit, after: () => void) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, init)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      setOpen(false)
      after()
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  const go = (href: string) => () => router.push(href)
  const lifecycle = (action: 'cancel' | 'duplicate' | 'new-version', confirmText?: string) => () => {
    if (confirmText && !window.confirm(confirmText)) return
    void call(
      `/api/documents/${documentId}/lifecycle`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) },
      () => router.refresh(),
    )
  }

  const view: Action = { label: 'צפייה במסמך', run: go(`/documents/${documentId}`) }
  const openCompany: Action | null = companyId
    ? { label: 'פתיחת החברה', run: go(`/companies/${companyId}`) }
    : null
  const link: Action | null = hasCompany ? null : { label: 'שיוך לספק/לקוח', run: go(`/documents/${documentId}`) }
  const duplicate: Action = { label: 'שכפול', run: lifecycle('duplicate') }
  const newVersion: Action = { label: 'גרסה חדשה', run: lifecycle('new-version') }

  const actions: (Action | null)[] =
    status === 'draft'
      ? [
          { label: 'עריכה', run: go(`/documents/${documentId}/edit`) },
          { label: 'שליחה', run: go(`/documents/${documentId}/send`) },
          duplicate,
          link,
          {
            label: 'מחיקה',
            danger: true,
            run: () => {
              if (!window.confirm('למחוק את הטיוטה? הפעולה אינה ניתנת לביטול.')) return
              void call(`/api/documents/${documentId}`, { method: 'DELETE' }, () => router.refresh())
            },
          },
        ]
      : status === 'sent' || status === 'viewed'
        ? [
            view,
            {
              label: 'שליחת תזכורת',
              run: () =>
                void call(`/api/documents/${documentId}/remind`, { method: 'POST' }, () => router.refresh()),
            },
            { label: 'ביטול המסמך', danger: true, run: lifecycle('cancel', 'לבטל את המסמך? קישור החתימה יפסיק לעבוד.') },
            link,
          ]
        : status === 'signed'
          ? [
              view,
              { label: 'הורדת PDF חתום', run: () => window.open(`/api/documents/${documentId}/download`, '_blank') },
              { label: 'הורדת אישור חתימה', run: () => window.open(`/api/documents/${documentId}/certificate`, '_blank') },
              openCompany,
              link,
              duplicate,
              newVersion,
            ]
          : [view, duplicate, newVersion, link]

  const available = actions.filter((a): a is Action => a !== null)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="פעולות"
        className="inline-flex size-11 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-fg"
      >
        ⋯
      </button>

      {open ? (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute end-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {available.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void action.run()}
              className={`block w-full px-4 py-2.5 text-start text-sm transition hover:bg-bg disabled:opacity-50 ${
                action.danger ? 'text-red-700' : 'text-fg'
              }`}
            >
              {action.label}
            </button>
          ))}
          {error ? (
            <p role="alert" className="px-4 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
