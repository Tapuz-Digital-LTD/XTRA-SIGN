'use client'

import { useState } from 'react'
import { FIELD_TYPES, type PageGeometry, type PlacedField } from '@/lib/fields'
import { PdfPage } from '@/components/PdfPage'

/**
 * A near-full-screen, read-only look at the document with its fields in place —
 * what the editor shows without the editing chrome, so someone can check "yes,
 * this is exactly what I meant" before sending. A signer-view toggle dims the
 * values we fill and highlights what the signer will be asked to complete.
 */
export function PreviewViewer({
  documentId,
  title,
  pages,
  fields,
  backHref,
}: {
  documentId: string
  title: string
  pages: PageGeometry[]
  fields: PlacedField[]
  backHref: string
}) {
  const [zoom, setZoom] = useState(100)
  const [signerView, setSignerView] = useState(false)

  const clamp = (z: number) => setZoom(Math.min(200, Math.max(50, z)))

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-200">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <a
          href={backHref}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-fg hover:bg-slate-100"
        >
          <span aria-hidden="true">→</span> חזרה לעריכה
        </a>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{title}</h1>

        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-fg">
          <input type="checkbox" checked={signerView} onChange={(e) => setSignerView(e.target.checked)} className="h-4 w-4" />
          תצוגת החותם
        </label>

        <div className="flex items-center rounded-lg border border-line bg-white">
          <button type="button" onClick={() => clamp(zoom - 25)} aria-label="הקטנה" className="min-h-9 w-9 text-lg text-fg hover:bg-slate-100">
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-fg">{zoom}%</span>
          <button type="button" onClick={() => clamp(zoom + 25)} aria-label="הגדלה" className="min-h-9 w-9 text-lg text-fg hover:bg-slate-100">
            +
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-4">
        <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '900px' : 'none' }}>
          {pages.map((page) => (
            <div key={page.pageNumber} className="w-full">
              <div
                className="relative w-full overflow-hidden rounded-lg border border-line bg-white shadow-md"
                style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
              >
                <PdfPage
                  url={`/api/documents/${documentId}/file`}
                  pageNumber={page.pageNumber}
                  widthPt={page.widthPt}
                  heightPt={page.heightPt}
                  className="absolute inset-0"
                />
                {fields
                  .filter((f) => f.page === page.pageNumber)
                  .map((field) => (
                    <PreviewField key={field.id} field={field} signerView={signerView} />
                  ))}
              </div>
              <p className="mt-1 text-center text-xs text-muted">
                עמוד {page.pageNumber} מתוך {pages.length}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PreviewField({ field, signerView }: { field: PlacedField; signerView: boolean }) {
  const spec = FIELD_TYPES.find((f) => f.type === field.type)
  const isSigner = field.ownedBy === 'signer'
  const filledByUs = !isSigner && field.value?.trim()

  const text =
    field.type === 'signature'
      ? '✒️ חתימה'
      : field.type === 'checkbox'
        ? field.value === 'true'
          ? '☑'
          : '☐'
        : filledByUs
          ? field.value
          : field.autoFill && field.type === 'date'
            ? 'תאריך החתימה'
            : field.placeholder?.trim() || field.label

  // In signer view, the values we already filled read like normal document
  // text (no box), and only what the signer must do is highlighted.
  const showAsSignerTask = signerView && isSigner
  const showBox = signerView ? isSigner : true

  return (
    <div
      className={`absolute flex items-center justify-center overflow-hidden rounded text-center text-[11px] leading-tight ${
        showBox
          ? showAsSignerTask
            ? 'border-2 border-[var(--color-accent)] bg-blue-100/60 font-medium text-slate-800'
            : isSigner
              ? 'border border-dashed border-[var(--color-accent)] bg-blue-50/40 text-slate-600'
              : 'border border-slate-300 bg-amber-50/50 text-slate-700'
          : 'text-slate-800'
      }`}
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
      }}
    >
      <span className="truncate px-1">
        {signerView && !isSigner ? (filledByUs ? field.value : '') : (
          <>
            {field.type !== 'signature' && field.type !== 'checkbox' ? (
              <span aria-hidden="true" className="me-0.5 opacity-60">
                {spec?.icon}
              </span>
            ) : null}
            {text}
          </>
        )}
      </span>
    </div>
  )
}
