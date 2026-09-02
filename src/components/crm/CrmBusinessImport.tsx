'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { BusinessDocument } from '@/server/crm/business-documents'

/**
 * Bringing an existing Fireberry quote or order across to be signed.
 *
 * The user picks "הצעה 1758 · 11,000 ₪ · 07/03/2024" — a business document they
 * recognise. That it is assembled from a print template, a record and a table
 * of line items is machinery, and none of it appears here.
 */
export function CrmBusinessImport({
  companyId,
  kind = 'supplier',
}: {
  companyId: string
  kind?: 'supplier' | 'customer'
}) {
  const noun = kind === 'customer' ? 'הצעת מחיר' : 'הסכם'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [documents, setDocuments] = useState<BusinessDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/companies/${companyId}/crm-business`)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו לקרוא את הרשימה מ-Fireberry.')
        return
      }
      setDocuments(data.documents ?? [])
    } catch {
      setError('לא הצלחנו לקרוא את הרשימה מ-Fireberry.')
    } finally {
      setLoading(false)
    }
  }

  async function choose(doc: BusinessDocument) {
    setBusy(doc.id)
    setError(null)
    try {
      const response = await fetch(`/api/companies/${companyId}/crm-business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: doc.id, objectType: doc.objectType }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הייבוא נכשל.')
        return
      }
      router.push(`/documents/${data.agreementId}/edit`)
    } catch {
      setError('הייבוא נכשל. נסו שוב.')
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        {kind === 'customer' ? 'בחירת הצעת מחיר' : 'בחירת הסכם או הצעה'}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">
            {kind === 'customer' ? 'הצעות מחיר ב-Fireberry' : 'הסכמים והצעות ב-Fireberry'}
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p role="alert" className="px-4 py-3 text-sm text-red-800">{error}</p> : null}
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted">טוען מ-Fireberry…</p>
          ) : documents.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              לא נמצאו {noun === 'הצעת מחיר' ? 'הצעות מחיר' : 'הסכמים או הצעות'} לרשומה הזו ב-Fireberry.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void choose(doc)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-start transition hover:bg-bg disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{doc.label}</span>
                      {doc.accountName ? <span className="block truncate text-xs text-muted">{doc.accountName}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{busy === doc.id ? 'מייבא…' : '←'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          המסמך יופק מתבנית ״{kind === 'customer' ? 'הצעת מחיר' : 'הסכם ספקים'}״ עם כל הנתונים והשורות שבו.
          שום דבר ב-Fireberry לא משתנה.
        </p>
      </div>
    </div>
  )
}
