'use client'

import { useRef, useState } from 'react'
import { FIELD_LABELS, type PageGeometry, type PlacedField } from '@/lib/fields'

/**
 * The document, with the signer's fields on it.
 *
 * The document is the page; everything else is a sticky bar at the bottom with
 * the single next action. "הבא" jumps to the next unfilled field so nobody has
 * to hunt through a contract on a phone.
 */
export function SignerDocument({
  token,
  title,
  pages,
  fields,
  values,
  remaining,
  error,
  busy,
  onChange,
  renderSignature,
}: {
  token: string
  title: string
  pages: PageGeometry[]
  fields: PlacedField[]
  values: Record<string, string>
  remaining: number
  error: string | null
  busy: boolean
  onChange: (id: string, value: string) => void
  renderSignature: (onDone: (completed: boolean) => void) => React.ReactNode
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  const signerFields = fields.filter((f) => f.ownedBy === 'signer')
  const toFill = signerFields.filter(
    (f) => f.type !== 'signature' && f.required && !values[f.id]?.trim(),
  )

  function jumpToNext() {
    const next = toFill[0]
    if (!next) return
    const element = container.current?.querySelector<HTMLElement>(`[data-field="${next.id}"]`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(
      () => element?.querySelector<HTMLElement>('input, select')?.focus(),
      400,
    )
  }

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
      </header>

      <div ref={container} className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4">
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-white"
            // The page's real shape, measured at conversion — never assumed.
            style={{ aspectRatio: `${page.imageWidth} / ${page.imageHeight}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/sign/${token}/pages/${page.pageNumber}`}
              alt={`עמוד ${page.pageNumber}`}
              className="absolute inset-0 h-full w-full"
            />

            {fields
              .filter((f) => f.page === page.pageNumber)
              .map((field) => (
                <FieldOverlay
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ''}
                  onChange={(v) => onChange(field.id, v)}
                  onSignatureTap={() => setSheetOpen(true)}
                />
              ))}
          </div>
        ))}
      </div>

      {/* The one thing to do next, always reachable without scrolling. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p role="status" aria-live="polite" className="flex-1 text-sm text-muted">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : remaining > 0 ? (
              `נותרו ${remaining} שדות`
            ) : (
              'הכול מולא'
            )}
          </p>

          {remaining > 0 ? (
            <button
              type="button"
              onClick={jumpToNext}
              className="min-h-12 rounded-lg bg-brand px-8 text-sm font-medium text-white"
            >
              הבא
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setSheetOpen(true)}
              className="min-h-12 rounded-lg bg-brand px-8 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? 'חותם…' : 'חתימה'}
            </button>
          )}
        </div>
      </div>

      {sheetOpen ? renderSignature(() => setSheetOpen(false)) : null}
    </div>
  )
}

/** One field, positioned by its fraction of the page. */
function FieldOverlay({
  field,
  value,
  onChange,
  onSignatureTap,
}: {
  field: PlacedField
  value: string
  onChange: (value: string) => void
  onSignatureTap: () => void
}) {
  const ours = field.ownedBy === 'sender'

  // `left`/`top`, not logical properties: the page is a canvas in the PDF's
  // left-origin coordinate system, and dir="rtl" would mirror it.
  const style = {
    left: `${field.x * 100}%`,
    top: `${field.y * 100}%`,
    width: `${field.width * 100}%`,
    height: `${field.height * 100}%`,
  }

  if (ours) {
    return (
      <div
        style={style}
        className="absolute flex items-center justify-end px-1 text-[max(9px,1.4cqw)] text-slate-800"
      >
        <span className="truncate">{field.value}</span>
      </div>
    )
  }

  if (field.type === 'signature') {
    return (
      <button
        type="button"
        data-field={field.id}
        onClick={onSignatureTap}
        style={style}
        aria-label={`חתימה: ${field.label}`}
        className={`absolute flex items-center justify-center rounded border-2 border-dashed text-[10px] font-medium ${
          value ? 'border-[var(--status-success)] bg-green-50' : 'border-[var(--color-accent)] bg-blue-50/70'
        }`}
      >
        {value ? '✓ נחתם' : 'לחצו לחתימה'}
      </button>
    )
  }

  const common =
    'absolute rounded border-2 border-[var(--color-accent)] bg-blue-50/80 px-1 text-[max(9px,1.2cqw)] text-slate-900 outline-none focus:bg-white'

  if (field.type === 'select') {
    return (
      <div data-field={field.id} style={style} className="absolute">
        <label className="sr-only" htmlFor={`f-${field.id}`}>
          {field.label}
        </label>
        <select
          id={`f-${field.id}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${common} inset-0 h-full w-full`}
        >
          <option value="">{field.label}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div data-field={field.id} style={style} className="absolute flex items-center justify-center">
        <label className="sr-only" htmlFor={`f-${field.id}`}>
          {field.label}
        </label>
        <input
          id={`f-${field.id}`}
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : '')}
          className="h-full max-h-5 w-full max-w-5"
        />
      </div>
    )
  }

  const inputType =
    field.type === 'date' ? 'date' : field.type === 'number' ? 'number' :
    field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'

  return (
    <div data-field={field.id} style={style} className="absolute">
      <label className="sr-only" htmlFor={`f-${field.id}`}>
        {field.label} ({FIELD_LABELS[field.type]})
      </label>
      <input
        id={`f-${field.id}`}
        type={inputType}
        value={value}
        placeholder={field.label}
        onChange={(e) => onChange(e.target.value)}
        className={`${common} inset-0 h-full w-full`}
      />
    </div>
  )
}
