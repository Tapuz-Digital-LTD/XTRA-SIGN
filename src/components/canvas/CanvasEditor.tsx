'use client'

import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Copy, Eye, EyeOff,
  Image as ImageIcon, Lock, Minus, Plus, Redo2, Square, Table as TableIcon,
  Trash2, Type, Undo2, Unlock,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Artboard } from './Artboard'
import { ElementToolbar } from './ElementToolbar'
import {
  FIELD_PRESETS, SHAPE_PRESETS, TEXT_PRESETS, fieldElement, imageElement, tableElement,
} from './element-factory'
import {
  emptyDocument, findElement, mmToPx,
  type CanvasDocument, type CanvasElement,
} from '@/lib/canvas/model'
import { tourismShowcase } from '@/lib/canvas/showcase'
import { apply, commit, initHistory, redo, undo, type Command, type History } from '@/lib/canvas/store'
import { useUnsavedGuard } from '@/components/editor/useUnsavedGuard'

/**
 * The canvas editor: A4 pages, freely placed elements, one document model.
 *
 * Every gesture goes through the same commands XTRA AI uses, so what a person
 * can do by hand the assistant can do by asking — and both land in the same
 * undo history.
 */

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export function CanvasEditor({
  companyId,
  companyName,
  agreementId,
  initialDocument,
  initialTitle,
}: {
  companyId: string
  companyName: string
  agreementId?: string
  initialDocument?: CanvasDocument
  initialTitle?: string
}) {
  const router = useRouter()
  const [history, setHistory] = useState<History>(() =>
    initHistory(initialDocument ?? emptyDocument(initialTitle ?? '')),
  )
  const document = history.present

  const [title, setTitle] = useState(initialTitle ?? '')
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [zoom, setZoom] = useState(0.75)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const page = document.pages[Math.min(pageIndex, document.pages.length - 1)]
  const selected = selectedIds.length === 1 ? findElement(document, selectedIds[0])?.element : undefined

  const { navigate, modal } = useUnsavedGuard(dirty)

  /** One change, one undo step. */
  const run = useCallback((command: Command) => {
    setHistory((current) => commit(current, apply(current.present, command)))
    setDirty(true)
  }, [])

  /** A live drag: replaces the present without adding history until it ends. */
  const preview = useCallback((elementId: string, patch: Partial<CanvasElement>) => {
    setHistory((current) => ({
      ...current,
      present: apply(current.present, { type: 'update', elementId, patch }),
    }))
    setDirty(true)
  }, [])

  const commitPreview = useCallback(() => {
    setHistory((current) => ({ ...current, past: [...current.past, current.present].slice(-60), future: [] }))
  }, [])

  const addElement = useCallback(
    (element: CanvasElement) => {
      run({ type: 'add', pageIndex, element })
      setSelectedIds([element.id])
    },
    [pageIndex, run],
  )

  // Keyboard: the shortcuts a design tool is expected to have.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && /input|textarea/i.test(target.tagName)) return
      const meta = event.metaKey || event.ctrlKey

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setHistory((current) => (event.shiftKey ? redo(current) : undo(current)))
        setDirty(true)
        return
      }
      if (meta && event.key.toLowerCase() === 'd' && selectedIds.length) {
        event.preventDefault()
        run({ type: 'duplicate', elementIds: selectedIds })
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault()
        run({ type: 'delete', elementIds: selectedIds })
        setSelectedIds([])
        return
      }
      if (event.key.startsWith('Arrow') && selectedIds.length === 1) {
        event.preventDefault()
        const step = event.shiftKey ? 5 : 1
        const found = findElement(document, selectedIds[0])
        if (!found) return
        const patch =
          event.key === 'ArrowUp' ? { y: found.element.y - step }
          : event.key === 'ArrowDown' ? { y: found.element.y + step }
          : event.key === 'ArrowLeft' ? { x: found.element.x - step }
          : { x: found.element.x + step }
        run({ type: 'update', elementId: selectedIds[0], patch })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [document, run, selectedIds])

  function pickImage(onPicked: (dataUrl: string) => void) {
    const input = window.document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    // In the DOM before the click: some browsers quietly ignore a click on a
    // detached input, which reads as the button doing nothing at all.
    input.style.display = 'none'
    window.document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      if (file.size > MAX_IMAGE_BYTES) {
        setError('התמונה גדולה מדי (עד 4MB).')
        return
      }
      const reader = new FileReader()
      // Inlined here so the document carries its own images; the renderer
      // refuses to fetch anything remote.
      reader.onload = () => onPicked(String(reader.result))
      reader.readAsDataURL(file)
    }
    input.oncancel = () => input.remove()
    input.click()
  }

  async function save() {
    const name = title.trim()
    if (!name) {
      setError('יש להזין שם למסמך כדי להמשיך.')
      titleRef.current?.focus()
      return
    }
    setSaving('saving')
    setError(null)
    try {
      const response = await fetch('/api/documents/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name, document, companyId, agreementId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השמירה נכשלה.')
        setSaving('idle')
        return
      }
      setDirty(false)
      setSaving('saved')
      router.push(`/documents/${data.agreementId}`)
    } catch {
      setError('השמירה נכשלה. נסו שוב.')
      setSaving('idle')
    }
  }

  const fitZoom = useCallback((mode: 'page' | 'width') => {
    const viewport = scrollRef.current
    if (!viewport) return 0.75
    const byWidth = (viewport.clientWidth - 48) / mmToPx(210)
    if (mode === 'width') return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, byWidth))
    const byHeight = (viewport.clientHeight - 48) / mmToPx(297)
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(byWidth, byHeight)))
  }, [])

  useEffect(() => {
    setZoom(fitZoom('page'))
  }, [fitZoom])

  const layers = useMemo(
    () => [...page.elements].sort((a, b) => b.zIndex - a.zIndex),
    [page.elements],
  )

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-200">
      {modal}

      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 overflow-hidden border-b border-line bg-surface px-3">
        <button
          type="button"
          onClick={() => navigate(`/documents/new?company=${companyId}`)}
          className="min-h-11 rounded-lg px-2 text-sm text-muted hover:text-fg"
        >
          → חזרה
        </button>
        <input
          ref={titleRef}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setDirty(true)
            if (error) setError(null)
          }}
          placeholder="שם המסמך"
          aria-invalid={Boolean(error) && !title.trim()}
          className={`min-h-11 min-w-0 flex-1 rounded-lg border bg-bg px-3 text-sm font-medium text-fg outline-none sm:max-w-xs ${
            error && !title.trim() ? 'border-red-500' : 'border-line focus:border-brand'
          }`}
        />
        <span className="hidden text-xs text-muted sm:inline">עבור {companyName}</span>

        <div className="flex items-center rounded-lg border border-line bg-white">
          <button type="button" aria-label="ביטול" disabled={history.past.length === 0}
            onClick={() => { setHistory(undo); setDirty(true) }}
            className="inline-flex size-9 items-center justify-center text-fg disabled:opacity-30">
            <Undo2 size={16} />
          </button>
          <button type="button" aria-label="שחזור" disabled={history.future.length === 0}
            onClick={() => { setHistory(redo); setDirty(true) }}
            className="inline-flex size-9 items-center justify-center text-fg disabled:opacity-30">
            <Redo2 size={16} />
          </button>
        </div>

        <div className="flex items-center rounded-lg border border-line bg-white">
          <button type="button" aria-label="הקטנה" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 0.25))}
            className="inline-flex size-9 items-center justify-center text-fg"><Minus size={15} /></button>
          <span className="w-12 text-center text-xs tabular-nums text-fg">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="הגדלה" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 0.25))}
            className="inline-flex size-9 items-center justify-center text-fg"><Plus size={15} /></button>
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <button type="button" onClick={() => setZoom(fitZoom('page'))}
            className="min-h-9 whitespace-nowrap px-2 text-xs text-fg">עמוד מלא</button>
          <button type="button" onClick={() => setZoom(fitZoom('width'))}
            className="min-h-9 whitespace-nowrap px-2 text-xs text-fg">רוחב</button>
        </div>

        <span className="text-xs text-muted" aria-live="polite">
          {saving === 'saving' ? 'שומר…' : saving === 'saved' ? 'נשמר' : dirty ? 'יש שינויים שלא נשמרו' : ''}
        </span>

        <button
          type="button"
          disabled={saving === 'saving'}
          onClick={() => void save()}
          className="ms-auto inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving === 'saving' ? 'שומר…' : 'שמירה והמשך'}
        </button>
      </header>

      {error ? (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {selected ? (
        <ElementToolbar
          element={selected}
          onUpdate={(patch) => run({ type: 'update', elementId: selected.id, patch })}
          onReplaceImage={() => pickImage((src) => run({ type: 'update', elementId: selected.id, patch: { src } as never }))}
        />
      ) : null}

      {/* overflow-hidden so nothing in a panel can widen the row and push
          the opposite sidebar off the screen. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Add elements */}
        <aside className="hidden w-44 shrink-0 overflow-y-auto overflow-x-hidden border-e border-line bg-surface p-2 lg:block">
          {document.pages.length === 1 && document.pages[0].elements.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                // Loads a finished design to start from, so the first document
                // begins from craft rather than a blank page. One undo step.
                const showcase = tourismShowcase()
                setHistory((current) => commit(current, showcase))
                if (!title.trim()) setTitle(showcase.title)
                setPageIndex(0)
                setSelectedIds([])
                setDirty(true)
              }}
              className="mb-3 w-full rounded-lg border border-brand bg-blue-50 px-2 py-2.5 text-start text-xs font-medium text-fg transition hover:bg-blue-100"
            >
              עיצוב מוכן לדוגמה
              <span className="mt-0.5 block text-[11px] font-normal text-muted">
                הסכם חודש התיירות — 3 עמודים מעוצבים
              </span>
            </button>
          ) : null}
          <Group title="טקסט">
            {Object.entries(TEXT_PRESETS).map(([key, make]) => (
              <Item key={key} icon={Type} label={key === 'heading' ? 'כותרת' : key === 'subheading' ? 'כותרת משנה' : 'טקסט'}
                onClick={() => addElement(make(page))} />
            ))}
          </Group>
          <Group title="מדיה">
            <Item icon={ImageIcon} label="תמונה" onClick={() => pickImage((src) => addElement(imageElement(page, src)))} />
            <Item icon={ImageIcon} label="לוגו" onClick={() => pickImage((src) => addElement(imageElement(page, src, 'לוגו')))} />
          </Group>
          <Group title="עיצוב">
            {Object.entries(SHAPE_PRESETS).map(([key, make]) => (
              <Item key={key} icon={Square} label={key === 'rect' ? 'מלבן' : key === 'circle' ? 'עיגול' : 'קו'}
                onClick={() => addElement(make(page))} />
            ))}
            <Item icon={ImageIcon} label="רקע לעמוד"
              onClick={() => pickImage((image) => run({ type: 'setBackground', pageIndex, background: { image, overlayColor: '#000000', overlayOpacity: 0.25 } }))} />
          </Group>
          <Group title="תוכן">
            <Item icon={TableIcon} label="טבלה" onClick={() => addElement(tableElement(page))} />
          </Group>
          <Group title="שדות לחתימה">
            {FIELD_PRESETS.map((preset) => (
              <Item key={preset.type} label={preset.label} onClick={() => addElement(fieldElement(page, preset.type))} />
            ))}
          </Group>
        </aside>

        {/* Pages */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mx-auto flex w-fit flex-col items-center gap-6">
            <Artboard
              page={page}
              pageIndex={pageIndex}
              zoom={zoom}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onChange={preview}
              onCommit={commitPreview}
              onEditText={(elementId, text) => preview(elementId, { text } as never)}
            />
          </div>
        </div>

        {/* Layers and pages */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto overflow-x-hidden border-s border-line bg-surface lg:block">
          <div className="border-b border-line p-2">
            <h2 className="mb-1 px-1 text-xs font-semibold text-muted">עמודים</h2>
            <div className="flex flex-wrap gap-1">
              {document.pages.map((candidate, index) => (
                <button key={candidate.id} type="button" onClick={() => { setPageIndex(index); setSelectedIds([]) }}
                  className={`inline-flex size-9 items-center justify-center rounded border text-xs ${
                    index === pageIndex ? 'border-brand bg-blue-50 font-semibold text-fg' : 'border-line text-muted'
                  }`}>{index + 1}</button>
              ))}
              <button type="button" aria-label="הוספת עמוד" onClick={() => { run({ type: 'addPage', afterIndex: pageIndex }); setPageIndex(pageIndex + 1) }}
                className="inline-flex size-9 items-center justify-center rounded border border-dashed border-line text-muted"><Plus size={14} /></button>
            </div>
            <div className="mt-1 flex gap-1">
              <button type="button" onClick={() => run({ type: 'duplicatePage', pageIndex })}
                className="min-h-9 flex-1 rounded border border-line text-xs text-fg">שכפל</button>
              <button type="button" disabled={document.pages.length <= 1}
                onClick={() => { run({ type: 'deletePage', pageIndex }); setPageIndex(Math.max(0, pageIndex - 1)) }}
                className="min-h-9 flex-1 rounded border border-line text-xs text-red-700 disabled:opacity-40">מחק</button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              רקע
              <input type="color" aria-label="צבע רקע לעמוד" value={page.background?.color ?? '#ffffff'}
                onChange={(event) => run({ type: 'setBackground', pageIndex, background: { color: event.target.value } })}
                className="h-8 w-10 cursor-pointer rounded border border-line" />
            </label>
          </div>

          <div className="p-2">
            <h2 className="mb-1 px-1 text-xs font-semibold text-muted">שכבות</h2>
            {layers.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted">העמוד ריק.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {layers.map((element) => (
                  <li key={element.id}>
                    <div className={`flex items-center gap-1 rounded px-1 ${selectedIds.includes(element.id) ? 'bg-blue-50' : ''}`}>
                      <button type="button" onClick={() => setSelectedIds([element.id])}
                        className="min-w-0 flex-1 truncate py-2 text-start text-xs text-fg">
                        {element.name ?? labelFor(element)}
                      </button>
                      <button type="button" aria-label={element.hidden ? 'הצג' : 'הסתר'}
                        onClick={() => run({ type: 'update', elementId: element.id, patch: { hidden: !element.hidden } })}
                        className="inline-flex size-7 items-center justify-center text-muted hover:text-fg">
                        {element.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button type="button" aria-label={element.locked ? 'שחרור נעילה' : 'נעילה'}
                        onClick={() => run({ type: 'update', elementId: element.id, patch: { locked: !element.locked } })}
                        className="inline-flex size-7 items-center justify-center text-muted hover:text-fg">
                        {element.locked ? <Lock size={13} /> : <Unlock size={13} />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {selectedIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
                <Mini icon={ArrowUp} label="הבא קדימה" onClick={() => run({ type: 'reorder', elementId: selectedIds[0], direction: 'forward' })} />
                <Mini icon={ArrowDown} label="שלח אחורה" onClick={() => run({ type: 'reorder', elementId: selectedIds[0], direction: 'backward' })} />
                <Mini icon={Copy} label="שכפול" onClick={() => run({ type: 'duplicate', elementIds: selectedIds })} />
                <Mini icon={Trash2} label="מחיקה" onClick={() => { run({ type: 'delete', elementIds: selectedIds }); setSelectedIds([]) }} />
                <Mini icon={AlignRight} label="יישור לימין" onClick={() => run({ type: 'align', elementIds: selectedIds, mode: 'right' })} />
                <Mini icon={AlignCenter} label="מרכוז" onClick={() => run({ type: 'align', elementIds: selectedIds, mode: 'center' })} />
                <Mini icon={AlignLeft} label="יישור לשמאל" onClick={() => run({ type: 'align', elementIds: selectedIds, mode: 'left' })} />
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

function labelFor(element: CanvasElement): string {
  switch (element.kind) {
    case 'text': return element.text.slice(0, 24) || 'טקסט'
    case 'image': return 'תמונה'
    case 'table': return 'טבלה'
    case 'field': return element.label
    case 'line': return 'קו'
    default: return 'צורה'
  }
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h2 className="mb-1 px-1 text-xs font-semibold text-muted">{title}</h2>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

function Item({ icon: Icon, label, onClick }: { icon?: typeof Type; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-bg px-2 text-start text-xs text-fg transition hover:border-brand">
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {label}
    </button>
  )
}

function Mini({ icon: Icon, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="inline-flex size-8 items-center justify-center rounded border border-line text-fg hover:border-brand">
      <Icon size={14} />
    </button>
  )
}
