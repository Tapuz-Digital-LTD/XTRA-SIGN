'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CrmFile } from '@/server/crm/import-documents'

/**
 * Bring a company's Fireberry files into XTRA Sign — the operator picks which.
 *
 * Nothing is imported automatically and nothing in the CRM is changed. A file
 * already imported shows "כבר יובא" and cannot be brought over twice; only PDFs
 * can become signing documents, and other types are listed with the reason.
 */
export function CrmDocumentImport({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<CrmFile[]>([])
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
      const response = await fetch(`/api/companies/${companyId}/crm-documents`)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו לקרוא את רשימת המסמכים.')
        return
      }
      setFiles(data.files ?? [])
    } catch {
      setError('לא הצלחנו לקרוא את רשימת המסמכים. בדקו את החיבור לאינטרנט.')
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setChosen((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/companies/${companyId}/crm-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [...chosen] }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הייבוא נכשל.')
        return
      }
      let msg = `יובאו ${data.imported}`
      if (data.skipped > 0) msg += ` · דולגו ${data.skipped} (כבר יובאו)`
      if (Array.isArray(data.failed) && data.failed.length > 0) {
        msg += ` · נכשלו ${data.failed.length}: ${data.failed.map((f: { name: string; reason: string }) => `${f.name} — ${f.reason}`).join('; ')}`
      }
      setResult(msg)
      router.refresh()
      await openAndLoadQuiet()
    } catch {
      setError('הייבוא נכשל. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  // Refresh the list in place so "כבר יובא" appears without closing the dialog.
  async function openAndLoadQuiet() {
    try {
      const response = await fetch(`/api/companies/${companyId}/crm-documents`)
      const data = await response.json().catch(() => null)
      if (response.ok) setFiles(data.files ?? [])
      setChosen(new Set())
    } catch {
      /* the result message already stands */
    }
  }

  const selectable = files.filter((f) => f.isPdf && !f.alreadyImported)

  return (
    <>
      <button
        type="button"
        onClick={openAndLoad}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
      >
        ייבוא מסמכים מ-Fireberry
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base font-semibold text-fg">מסמכים ב-Fireberry</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="h-9 w-9 rounded-lg text-muted hover:bg-slate-100">
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted">טוען מסמכים…</p>
              ) : error ? (
                <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm text-danger">{error}</p>
              ) : files.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">אין מסמכים מצורפים לרשומה הזו ב-Fireberry.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {files.map((f) => {
                    const disabled = f.alreadyImported || !f.isPdf
                    return (
                      <li key={f.id}>
                        <label
                          className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                            disabled ? 'cursor-default border-line bg-bg' : 'cursor-pointer border-line bg-white hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0"
                            disabled={disabled}
                            checked={chosen.has(f.id)}
                            onChange={() => toggle(f.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-fg">{f.name}</span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {(f.extension || 'קובץ').toUpperCase()}
                              {f.sizeMb != null ? ` · ${f.sizeMb.toFixed(2)} MB` : ''}
                              {!f.isPdf ? ' · ניתן לייבא רק PDF' : ''}
                            </span>
                          </span>
                          {f.alreadyImported ? (
                            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">כבר יובא</span>
                          ) : null}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              {result ? (
                <p role="status" className="mt-3 rounded-lg border border-line bg-bg p-3 text-sm text-fg">{result}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-line px-5 py-3">
              <button
                type="button"
                onClick={runImport}
                disabled={busy || chosen.size === 0}
                className="min-h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'מייבא…' : chosen.size > 0 ? `ייבוא (${chosen.size})` : 'ייבוא'}
              </button>
              <span className="text-xs text-muted">
                {selectable.length > 0 ? `${selectable.length} קובצי PDF זמינים לייבוא` : 'אין קבצים חדשים לייבוא'}
              </span>
              <button type="button" onClick={() => setOpen(false)} className="ms-auto min-h-11 rounded-lg border border-line bg-white px-4 text-sm text-fg">
                סגירה
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
