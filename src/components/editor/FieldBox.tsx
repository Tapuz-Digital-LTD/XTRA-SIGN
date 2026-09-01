'use client'

import { useRef, type RefObject } from 'react'
import { FIELD_TYPES, type PlacedField } from '@/lib/fields'

/**
 * One field on the page: draggable, resizable, selectable.
 *
 * Every measurement is a fraction of the container's own box, read at the
 * moment of the gesture. Nothing is cached in pixels, so a page that is 320px
 * wide on a phone and 900px on a desktop produces identical stored values.
 *
 * Pointer events rather than mouse/touch pairs: one code path covers mouse,
 * touch and pen, and pointer capture means a fast drag that leaves the element
 * still tracks instead of dropping the field mid-gesture.
 */
export function FieldBox({
  field,
  selected,
  containerRef,
  onSelect,
  onUpdate,
}: {
  field: PlacedField
  selected: boolean
  containerRef: RefObject<HTMLDivElement | null>
  onSelect: () => void
  onUpdate: (patch: Partial<PlacedField>) => void
}) {
  const gesture = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    origin: { x: number; y: number; width: number; height: number }
    rect: DOMRect
  } | null>(null)

  const spec = FIELD_TYPES.find((f) => f.type === field.type)
  const isSigner = field.ownedBy === 'signer'

  function begin(event: React.PointerEvent, mode: 'move' | 'resize') {
    // Stop the page's own handler from clearing the selection underneath us.
    event.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    onSelect()
    ;(event.target as Element).setPointerCapture(event.pointerId)

    gesture.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: field.x, y: field.y, width: field.width, height: field.height },
      rect,
    }
  }

  function move(event: React.PointerEvent) {
    const g = gesture.current
    if (!g) return

    // Delta in fractions of the container, so the same physical drag means the
    // same thing at any rendered width.
    const dx = (event.clientX - g.startX) / g.rect.width
    const dy = (event.clientY - g.startY) / g.rect.height

    if (g.mode === 'move') {
      onUpdate({ x: g.origin.x + dx, y: g.origin.y + dy })
    } else {
      onUpdate({ width: g.origin.width + dx, height: g.origin.height + dy })
    }
  }

  function end(event: React.PointerEvent) {
    const target = event.target as Element
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    gesture.current = null
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${field.label}, ${isSigner ? 'החותם ממלא' : 'אנחנו ממלאים'}`}
      aria-pressed={selected}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        // Keyboard nudging, so placing a field does not require a pointer.
        const step = event.shiftKey ? 0.05 : 0.005
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }
        const delta = moves[event.key]
        if (!delta) return
        event.preventDefault()
        onUpdate({ x: field.x + delta[0], y: field.y + delta[1] })
      }}
      className={`absolute flex touch-none items-center justify-center rounded border-2 text-[10px] font-medium transition-shadow ${
        selected
          ? 'border-[var(--color-accent)] bg-blue-50/90 shadow-md'
          : isSigner
            ? 'border-dashed border-[var(--color-accent)] bg-blue-50/60'
            : 'border-slate-400 bg-slate-100/85'
      }`}
      style={{
        // `left`, NOT `insetInlineStart`.
        //
        // The app is dir="rtl", so a logical property measures from the right
        // and mirrors the field: a signature stored 67% from the left rendered
        // 5% from the left, and the signed PDF would have disagreed with what
        // the user saw. The page is a canvas with the PDF's own left-origin
        // coordinate system, not flowing text, so it uses physical properties.
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
        cursor: 'move',
      }}
    >
      <span className="pointer-events-none truncate px-1 text-slate-700">
        {spec?.icon} {field.label}
        {field.required ? ' *' : ''}
      </span>

      {selected ? (
        <span
          role="slider"
          aria-label="שינוי גודל"
          aria-valuenow={Math.round(field.width * 100)}
          aria-valuemin={2}
          aria-valuemax={100}
          tabIndex={-1}
          onPointerDown={(e) => begin(e, 'resize')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          // 16px, not the 8px a desktop design would use: this has to be
          // grabbable with a fingertip.
          // `right`, not `insetInlineEnd`, for the same reason as the box itself:
          // the handle belongs on the field's bottom-right corner in page
          // coordinates, regardless of text direction.
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--color-accent)]"
        />
      ) : null}
    </div>
  )
}
