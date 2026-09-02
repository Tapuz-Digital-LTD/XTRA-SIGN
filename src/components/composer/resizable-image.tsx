'use client'

import { mergeAttributes } from '@tiptap/core'
import TiptapImage from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

/**
 * An image you can actually size and place, the way a word processor does.
 *
 * The stock Image extension drops a fixed-size picture into the text and leaves
 * you with no way to change it. Here the image carries its own width and
 * alignment, both of which are written into the HTML as inline CSS — so the
 * size chosen on screen is the size that prints, rather than a preview that
 * quietly disagrees with the PDF.
 */

type Align = 'right' | 'center' | 'left'

/** Alignment as inline CSS, so it survives into the rendered document. */
const ALIGN_CSS: Record<Align, string> = {
  right: 'margin-inline-start:0;margin-inline-end:auto',
  center: 'margin-inline-start:auto;margin-inline-end:auto',
  left: 'margin-inline-start:auto;margin-inline-end:0',
}

/** Below this an image is too small to grab; above it, wider than the page. */
const MIN_WIDTH = 48
const MAX_WIDTH = 1400

/** Corner handles keep the aspect ratio; side handles stretch one axis. */
const HANDLES = [
  { id: 'nw', corner: true, css: 'top-0 start-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { id: 'ne', corner: true, css: 'top-0 end-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { id: 'sw', corner: true, css: 'bottom-0 start-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { id: 'se', corner: true, css: 'bottom-0 end-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  { id: 'w', corner: false, css: 'top-1/2 start-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'e', corner: false, css: 'top-1/2 end-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
] as const

function ImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [live, setLive] = useState<{ w: number; h: number } | null>(null)
  const width = (node.attrs.width as number | null) ?? null
  const align = ((node.attrs.align as Align) ?? 'right') satisfies Align

  /**
   * Resizing driven by pointer events rather than mouse events, so a finger on
   * a tablet works the same as a mouse. The pointer is captured for the whole
   * drag: without it, moving faster than React re-renders drops the gesture the
   * moment the cursor leaves the 12px handle.
   */
  const startResize = useCallback(
    (event: React.PointerEvent, handle: (typeof HANDLES)[number]) => {
      event.preventDefault()
      event.stopPropagation()
      const img = imgRef.current
      if (!img) return

      const startX = event.clientX
      const startW = img.offsetWidth
      const ratio = img.offsetHeight / img.offsetWidth || 1
      // In RTL a west handle grows the image when dragged further west, which is
      // the opposite sign to the same handle in a left-to-right document.
      const rtl = getComputedStyle(img).direction === 'rtl'
      const westward = handle.id.includes('w')
      const sign = westward === rtl ? 1 : -1

      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)

      const onMove = (move: PointerEvent) => {
        const next = Math.round(
          Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (move.clientX - startX) * sign)),
        )
        img.style.width = `${next}px`
        setLive({ w: next, h: Math.round(next * ratio) })
      }
      const onUp = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        setLive(null)
        updateAttributes({ width: img.offsetWidth })
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [updateAttributes],
  )

  /**
   * Clicking the picture selects it.
   *
   * ProseMirror does not hand a node selection to a node view whose content is
   * a plain `<img>`, so without this the handles only ever appeared on a
   * freshly inserted image and clicking an existing one did nothing at all.
   */
  const select = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
  }, [editor, getPos])

  const editable = editor.isEditable

  return (
    <NodeViewWrapper
      className="relative my-3"
      style={{ textAlign: align === 'center' ? 'center' : align === 'left' ? 'left' : 'right' }}
    >
      <span className={`relative inline-block max-w-full ${selected ? 'outline-2 outline-brand' : ''}`}>
        <img
          ref={imgRef}
          src={node.attrs.src as string}
          alt={(node.attrs.alt as string) ?? ''}
          onMouseDown={select}
          onTouchStart={select}
          draggable={false}
          className="cursor-pointer"
          style={{ width: width ? `${width}px` : undefined, height: 'auto', maxWidth: '100%', display: 'block' }}
        />

        {editable && selected ? (
          <>
            {HANDLES.map((handle) => (
              <span
                key={handle.id}
                role="presentation"
                onPointerDown={(event) => startResize(event, handle)}
                // A 12px square is the visible grip; the padded hit area around
                // it is what a finger actually lands on.
                className={`absolute z-10 h-3 w-3 rounded-full border-2 border-white bg-brand shadow ring-1 ring-black/10 after:absolute after:-inset-2 after:content-[''] ${handle.css}`}
              />
            ))}

            {/* Alignment, placed above the image so it never covers it. */}
            <span
              contentEditable={false}
              className="absolute -top-11 start-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow)]"
            >
              {(
                [
                  { id: 'right', label: 'יישור לימין', Icon: AlignRight },
                  { id: 'center', label: 'מרכוז', Icon: AlignCenter },
                  { id: 'left', label: 'יישור לשמאל', Icon: AlignLeft },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={align === id}
                  onClick={() => updateAttributes({ align: id })}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded transition ${
                    align === id ? 'bg-brand text-white' : 'text-fg hover:bg-slate-100'
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-line" />
              <button
                type="button"
                title="גודל מקורי"
                aria-label="גודל מקורי"
                onClick={() => updateAttributes({ width: null })}
                className="inline-flex h-8 items-center rounded px-2 text-xs text-fg transition hover:bg-slate-100"
              >
                איפוס
              </button>
            </span>

            {/* The running dimensions, shown only while a handle is held. */}
            {live ? (
              <span className="pointer-events-none absolute bottom-1 end-1 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
                {live.w} × {live.h}
              </span>
            ) : null}
          </>
        ) : null}
      </span>
    </NodeViewWrapper>
  )
}

export const ResizableImage = TiptapImage.extend({
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      /** Width in CSS pixels. Null means "however wide the file is". */
      width: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('width') ?? element.style.width
          const parsed = Number.parseInt(attr ?? '', 10)
          return Number.isFinite(parsed) ? parsed : null
        },
      },
      align: {
        default: 'right',
        parseHTML: (element) => element.getAttribute('data-align') ?? 'right',
      },
    }
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width as number | null
    const align = ((node.attrs.align as Align) ?? 'right') satisfies Align
    const { width: _dropped, align: _alsoDropped, ...rest } = HTMLAttributes
    return [
      'img',
      mergeAttributes(rest, {
        'data-align': align,
        // Inline CSS rather than the width attribute: the print renderer honours
        // CSS, and `display:block` is what makes the auto margins centre it.
        style: `display:block;height:auto;max-width:100%;${width ? `width:${width}px;` : ''}${ALIGN_CSS[align]}`,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
