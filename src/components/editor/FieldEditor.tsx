'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FIELD_TYPES,
  clampToPage,
  type FieldType,
  type PageGeometry,
  type PlacedField,
} from '@/lib/fields'
import { PdfPage } from '@/components/PdfPage'
import { FieldBox } from './FieldBox'
import { FieldPanel } from './FieldPanel'
import { RecipientForm } from './RecipientForm'
import { useUnsavedGuard } from './useUnsavedGuard'

/**
 * The field editor — document first.
 *
 * The whole screen is the document. The tools sit in a thin top bar and open
 * over the page only when needed: the field palette from a button, a field's
 * settings when it is selected. Positions are page fractions throughout, so
 * zoom is purely visual and never moves a field's logical place.
 */

export type EditorRecipient = {
  name: string
  company: string | null
  phone: string | null
  email: string | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const ZOOM_MIN = 50
const ZOOM_MAX = 200

export function FieldEditor({
  documentId,
  title,
  pages,
  initialFields,
  initialRecipient,
}: {
  documentId: string
  title: string
  pages: PageGeometry[]
  initialFields: PlacedField[]
  initialRecipient: EditorRecipient | null
}) {
  const [fields, setFields] = useState<PlacedField[]>(initialFields)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const [zoom, setZoom] = useState(100)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [placingType, setPlacingType] = useState<FieldType | null>(null)
  const [recipientOpen, setRecipientOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const selected = fields.find((f) => f.id === selectedId) ?? null

  const { navigate, modal: unsavedModal } = useUnsavedGuard(dirty)

  // ── autosave (debounced, skipped on first render) ─────────────────────────
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    // A real document change happened; nothing is safe to leave until it saves.
    setDirty(true)
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          setSaveError(data?.error?.message ?? 'השמירה נכשלה.')
          setSaveState('error')
          return
        }
        setSaveError(null)
        setSaveState('saved')
        setDirty(false)
      } catch {
        setSaveError('השמירה נכשלה. בדקו את החיבור לאינטרנט.')
        setSaveState('error')
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [fields, documentId])

  // ── field operations ──────────────────────────────────────────────────────
  const addField = useCallback((type: FieldType, page: number, at?: { x: number; y: number }) => {
    const spec = FIELD_TYPES.find((f) => f.type === type)!
    const id = crypto.randomUUID()
    const x = at ? at.x - spec.defaultWidth / 2 : 0.5 - spec.defaultWidth / 2
    const y = at ? at.y - spec.defaultHeight / 2 : 0.45
    setFields((current) => [
      ...current,
      {
        id,
        type,
        label: spec.label,
        ownedBy: type === 'signature' ? 'signer' : 'sender',
        required: true,
        page,
        ...clampToPage({ x, y, width: spec.defaultWidth, height: spec.defaultHeight }),
        value: null,
        options: type === 'select' ? ['אפשרות 1', 'אפשרות 2'] : null,
        placeholder: null,
        autoFill: false,
      },
    ])
    setSelectedId(id)
  }, [])

  const updateField = useCallback((id: string, patch: Partial<PlacedField>) => {
    setFields((current) =>
      current.map((f) => (f.id === id ? { ...f, ...patch, ...clampToPage({ ...f, ...patch }) } : f)),
    )
  }, [])

  const deleteField = useCallback((id: string) => {
    setFields((current) => current.filter((f) => f.id !== id))
    setSelectedId((s) => (s === id ? null : s))
  }, [])

  const duplicateField = useCallback((id: string) => {
    setFields((current) => {
      const source = current.find((f) => f.id === id)
      if (!source) return current
      const copy: PlacedField = {
        ...source,
        id: crypto.randomUUID(),
        ...clampToPage({ ...source, x: source.x + 0.02, y: source.y + 0.03 }),
      }
      return [...current, copy]
    })
  }, [])

  // ── cross-page drag, driven from here so a field can move between pages ────
  const drag = useRef<{
    id: string
    pointerId: number
    grabDX: number
    grabDY: number
    widthPx: number
    heightPx: number
  } | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const pageAtPoint = (clientX: number, clientY: number): { page: number; rect: DOMRect } | null => {
    for (const [page, el] of pageRefs.current) {
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { page, rect }
      }
    }
    return null
  }

  const onFieldMoveStart = useCallback(
    (field: PlacedField, event: React.PointerEvent) => {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      drag.current = {
        id: field.id,
        pointerId: event.pointerId,
        grabDX: event.clientX - box.left,
        grabDY: event.clientY - box.top,
        widthPx: box.width,
        heightPx: box.height,
      }
      setGhost({ x: box.left, y: box.top, w: box.width, h: box.height, label: field.label })
      setDraggingId(field.id)
    },
    [],
  )

  useEffect(() => {
    if (!ghost) return

    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      setGhost((g) => (g ? { ...g, x: e.clientX - d.grabDX, y: e.clientY - d.grabDY } : g))

      // Auto-scroll when the pointer nears the top or bottom of the document.
      const sc = scrollRef.current
      if (sc) {
        const r = sc.getBoundingClientRect()
        const edge = 60
        if (e.clientY < r.top + edge) sc.scrollBy({ top: -12 })
        else if (e.clientY > r.bottom - edge) sc.scrollBy({ top: 12 })
      }
    }

    const onUp = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      setGhost(null)
      setDraggingId(null)
      if (!d) return
      // Aim from the field's centre so the drop lands where it looks like it
      // will, then fall back to the pointer itself.
      const target =
        pageAtPoint(e.clientX - d.grabDX + d.widthPx / 2, e.clientY - d.grabDY + d.heightPx / 2) ??
        pageAtPoint(e.clientX, e.clientY)
      if (!target) return
      const x = (e.clientX - d.grabDX - target.rect.left) / target.rect.width
      const y = (e.clientY - d.grabDY - target.rect.top) / target.rect.height
      // One update, with the field's real size, so clampToPage keeps it on page.
      // `page` is set explicitly — clampToPage only returns geometry.
      setFields((current) =>
        current.map((f) => (f.id === d.id ? { ...f, page: target.page, ...clampToPage({ ...f, x, y }) } : f)),
      )
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [ghost, updateField])

  // ── which page is in view, for the page indicator ─────────────────────────
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const onScroll = () => {
      const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2
      let best = 1
      let bestDist = Infinity
      for (const [page, el] of pageRefs.current) {
        const r = el.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - mid)
        if (dist < bestDist) {
          bestDist = dist
          best = page
        }
      }
      setCurrentPage(best)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [])

  const goToPage = (page: number) => {
    const el = pageRefs.current.get(page)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Delete/Escape, never while typing in a settings input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable]')) return
      if (event.key === 'Escape') {
        setSelectedId(null)
        setPlacingType(null)
        setPaletteOpen(false)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        deleteField(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, deleteField])

  const setZoomClamped = (z: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-200">
      {/* ── top toolbar ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => navigate(`/documents/${documentId}`)}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-fg hover:bg-slate-100"
        >
          <span aria-hidden="true">→</span> חזרה
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{title}</h1>

        {/* zoom */}
        <div className="flex items-center rounded-lg border border-line bg-white">
          <button type="button" onClick={() => setZoomClamped(zoom - 25)} aria-label="הקטנה" className="min-h-9 w-9 text-lg text-fg hover:bg-slate-100">
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-fg">{zoom}%</span>
          <button type="button" onClick={() => setZoomClamped(zoom + 25)} aria-label="הגדלה" className="min-h-9 w-9 text-lg text-fg hover:bg-slate-100">
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => setZoom(100)}
          className="hidden min-h-9 items-center rounded-lg border border-line bg-white px-2 text-xs text-fg hover:bg-slate-100 sm:inline-flex"
        >
          התאמה לרוחב
        </button>

        <button
          type="button"
          onClick={() => {
            setPaletteOpen((v) => !v)
            setPlacingType(null)
          }}
          className="inline-flex min-h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">+</span> הוספת שדה
        </button>
        <button
          type="button"
          onClick={() => setRecipientOpen(true)}
          className="inline-flex min-h-9 items-center rounded-lg border border-line bg-white px-3 text-sm text-fg hover:bg-slate-50"
        >
          חותם
        </button>
        <button
          type="button"
          onClick={() => navigate(`/documents/${documentId}/preview`)}
          className="inline-flex min-h-9 items-center rounded-lg border border-line bg-white px-3 text-sm text-fg hover:bg-slate-50"
        >
          תצוגה מקדימה
        </button>
        <button
          type="button"
          onClick={() => navigate(`/documents/${documentId}/send`)}
          className="inline-flex min-h-9 items-center rounded-lg border border-brand bg-brand/5 px-3 text-sm font-medium text-brand hover:bg-brand/10"
        >
          המשך לשליחה
        </button>

        <span
          role="status"
          aria-live="polite"
          title={saveState === 'error' ? (saveError ?? undefined) : undefined}
          className={`w-14 text-center text-xs ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}
        >
          {saveState === 'saving' ? 'שומר…' : saveState === 'saved' ? 'נשמר' : saveState === 'error' ? 'שגיאה' : ''}
        </span>
      </header>

      {placingType ? (
        <div className="flex items-center justify-center gap-3 bg-brand/10 px-3 py-1.5 text-sm text-fg">
          <span>
            לחצו במסמך כדי למקם: <span className="font-medium">{FIELD_TYPES.find((f) => f.type === placingType)?.label}</span>
          </span>
          <button type="button" onClick={() => setPlacingType(null)} className="rounded px-2 text-xs text-muted hover:text-fg">
            ביטול
          </button>
        </div>
      ) : null}

      {/* ── document area ───────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto px-2 py-4">
          <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '900px' : 'none' }}>
            {pages.map((page) => (
              <div key={page.pageNumber} className="w-full">
                <div
                  ref={(el) => {
                    if (el) pageRefs.current.set(page.pageNumber, el)
                    else pageRefs.current.delete(page.pageNumber)
                  }}
                  className={`relative w-full overflow-hidden rounded-lg border border-line bg-white shadow-md ${
                    placingType ? 'cursor-crosshair' : ''
                  }`}
                  style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget || e.target instanceof HTMLImageElement) setSelectedId(null)
                  }}
                  onClick={(e) => {
                    if (!placingType) return
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    addField(placingType, page.pageNumber, {
                      x: (e.clientX - rect.left) / rect.width,
                      y: (e.clientY - rect.top) / rect.height,
                    })
                    setPlacingType(null)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const type = e.dataTransfer.getData('application/x-xtra-field') as FieldType
                    if (!type) return
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    addField(type, page.pageNumber, {
                      x: (e.clientX - rect.left) / rect.width,
                      y: (e.clientY - rect.top) / rect.height,
                    })
                  }}
                >
                  <PdfPage
                    url={`/api/documents/${documentId}/file`}
                    pageNumber={page.pageNumber}
                    widthPt={page.widthPt}
                    heightPt={page.heightPt}
                    className="absolute inset-0"
                  />
                  {fields
                    .filter((f) => f.page === page.pageNumber && f.id !== draggingId)
                    .map((field) => (
                      <FieldBox
                        key={field.id}
                        field={field}
                        selected={field.id === selectedId}
                        getContainer={() => pageRefs.current.get(page.pageNumber) ?? null}
                        onSelect={() => setSelectedId(field.id)}
                        onResize={(patch) => updateField(field.id, patch)}
                        onMoveStart={(e) => onFieldMoveStart(field, e)}
                      />
                    ))}
                </div>
                <p className="mt-1 text-center text-xs text-muted">עמוד {page.pageNumber}</p>
              </div>
            ))}
          </div>
        </div>

        {/* settings drawer, only while a field is selected */}
        {selected ? (
          <aside className="absolute inset-y-0 left-0 z-20 w-full max-w-xs border-e border-line bg-surface shadow-xl sm:w-80">
            <FieldPanel
              field={selected}
              pageCount={pages.length}
              onChange={(patch) => updateField(selected.id, patch)}
              onDelete={() => deleteField(selected.id)}
              onDuplicate={() => duplicateField(selected.id)}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        ) : null}

        {/* page navigator */}
        {pages.length > 1 ? (
          <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-2 py-1 shadow-lg">
            <button
              type="button"
              onClick={() => goToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="עמוד קודם"
              className="h-8 w-8 rounded-full text-fg hover:bg-slate-100 disabled:opacity-40"
            >
              ›
            </button>
            <span className="px-1 text-xs text-fg">
              עמוד {currentPage} מתוך {pages.length}
            </span>
            <button
              type="button"
              onClick={() => goToPage(Math.min(pages.length, currentPage + 1))}
              disabled={currentPage >= pages.length}
              aria-label="עמוד הבא"
              className="h-8 w-8 rounded-full text-fg hover:bg-slate-100 disabled:opacity-40"
            >
              ‹
            </button>
          </div>
        ) : null}
      </div>

      {/* field palette popover */}
      {paletteOpen ? (
        <div className="absolute inset-0 z-30" onClick={() => setPaletteOpen(false)}>
          <div
            className="absolute end-3 top-14 w-64 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-1 pb-2 text-xs text-muted">גררו למסמך, או בחרו ולחצו על המקום הרצוי.</p>
            <ul className="grid grid-cols-2 gap-1.5">
              {FIELD_TYPES.map((spec) => (
                <li key={spec.type}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-xtra-field', spec.type)
                      e.dataTransfer.effectAllowed = 'copy'
                      setPaletteOpen(false)
                    }}
                    onClick={() => {
                      setPlacingType(spec.type)
                      setPaletteOpen(false)
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-start text-sm text-fg hover:border-[var(--color-accent)] hover:bg-blue-50"
                  >
                    <span aria-hidden="true" className="w-4 text-center">
                      {spec.icon}
                    </span>
                    <span className="truncate">{spec.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* recipient drawer */}
      {recipientOpen ? (
        <div className="absolute inset-0 z-30 bg-black/20" onClick={() => setRecipientOpen(false)}>
          <div
            className="absolute inset-y-0 end-0 w-full max-w-sm overflow-y-auto border-s border-line bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">פרטי החותם</h2>
              <button type="button" onClick={() => setRecipientOpen(false)} aria-label="סגירה" className="h-9 w-9 rounded-lg text-muted hover:bg-slate-100">
                ✕
              </button>
            </div>
            <RecipientForm documentId={documentId} initial={initialRecipient} />
          </div>
        </div>
      ) : null}

      {unsavedModal}

      {/* drag ghost */}
      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 flex items-center justify-center rounded border-2 border-[var(--color-accent)] bg-blue-50/90 text-[11px] font-medium text-slate-700 shadow-lg"
          style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}
        >
          <span className="truncate px-1">{ghost.label}</span>
        </div>
      ) : null}
    </div>
  )
}
