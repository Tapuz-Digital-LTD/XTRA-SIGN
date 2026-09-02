'use client'

import { FIELD_TYPES, type PlacedField } from '@/lib/fields'

/**
 * One field drawn on the page.
 *
 * Position and size are fractions of the page, so zoom and screen size never
 * change where the field sits. Moving is driven by the editor above (so a field
 * can cross pages); this component owns only selection, resize, and showing what
 * the field will actually say.
 */
export function FieldBox({
  field,
  selected,
  getContainer,
  onSelect,
  onResize,
  onMoveStart,
}: {
  field: PlacedField
  selected: boolean
  /** The page element this field sits on, read at gesture time, never in render. */
  getContainer: () => HTMLElement | null
  onSelect: () => void
  /** Live resize, in page fractions. */
  onResize: (patch: { width: number; height: number }) => void
  /** Hands the pointer to the editor's cross-page drag controller. */
  onMoveStart: (event: React.PointerEvent) => void
}) {
  const spec = FIELD_TYPES.find((f) => f.type === field.type)
  const isSigner = field.ownedBy === 'signer'

  // What the box shows: the value we will stamp (live), or a hint of what the
  // signer will fill. A picture of the outcome, not the field's plumbing.
  const preview =
    field.type === 'signature'
      ? '✒️ חתימה'
      : field.type === 'checkbox'
        ? field.value === 'true'
          ? '☑'
          : '☐'
        : !isSigner && field.value?.trim()
          ? field.value
          : field.autoFill && field.type === 'date'
            ? 'תאריך החתימה'
            : field.placeholder?.trim() || field.label

  const resizeStart = (event: React.PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const rect = getContainer()?.getBoundingClientRect()
    if (!rect) return
    const start = { x: event.clientX, y: event.clientY, w: field.width, h: field.height }
    ;(event.target as Element).setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      onResize({
        width: start.w + (e.clientX - rect.left - (start.x - rect.left)) / rect.width,
        height: start.h + (e.clientY - rect.top - (start.y - rect.top)) / rect.height,
      })
    }
    const up = (e: PointerEvent) => {
      ;(event.target as Element).releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void e
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${field.label}, ${isSigner ? 'החותם ממלא' : 'אנחנו ממלאים'}`}
      aria-pressed={selected}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect()
        onMoveStart(e)
      }}
      className={`absolute flex touch-none items-center justify-center overflow-hidden rounded border-2 text-center text-[11px] font-medium transition-shadow ${
        selected
          ? 'z-10 border-[var(--color-accent)] bg-blue-50/90 shadow-md'
          : isSigner
            ? 'border-dashed border-[var(--color-accent)] bg-blue-50/50'
            : 'border-slate-400 bg-amber-50/80'
      }`}
      style={{
        // Physical left/top, not logical: the page is a PDF coordinate canvas,
        // not flowing text, so RTL must not mirror the field.
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
        cursor: 'move',
      }}
    >
      <span className="pointer-events-none truncate px-1 leading-tight text-slate-700">
        {field.type !== 'signature' && field.type !== 'checkbox' ? (
          <span aria-hidden="true" className="me-0.5 opacity-60">
            {spec?.icon}
          </span>
        ) : null}
        {preview}
        {field.required && !(!isSigner && field.value?.trim()) ? (
          <span className="text-danger"> *</span>
        ) : null}
      </span>

      {selected ? (
        <span
          role="slider"
          aria-label="שינוי גודל"
          aria-valuenow={Math.round(field.width * 100)}
          aria-valuemin={2}
          aria-valuemax={100}
          tabIndex={-1}
          onPointerDown={resizeStart}
          className="absolute -bottom-2 -left-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--color-accent)]"
        />
      ) : null}
    </div>
  )
}
