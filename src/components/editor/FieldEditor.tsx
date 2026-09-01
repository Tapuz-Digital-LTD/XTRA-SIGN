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
import { FieldToolbar } from './FieldToolbar'
import { RecipientForm } from './RecipientForm'

/**
 * The field editor.
 *
 * Positions are fractions of the page throughout, converted to pixels only at
 * paint time using each page's own measured size. Nothing here knows or cares
 * whether a page is A4, Letter, portrait or landscape — which is exactly why a
 * signature dropped in the bottom-right corner stays there on a phone, on a
 * desktop, and on a landscape page.
 *
 * Drag and resize are plain pointer events. A DnD library would add a
 * dependency to do what four handlers already do, and would still need this
 * fraction arithmetic bolted on.
 */

export type EditorRecipient = {
  name: string
  company: string | null
  phone: string | null
  email: string | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function FieldEditor({
  documentId,
  pages,
  initialFields,
  initialRecipient,
}: {
  documentId: string
  pages: PageGeometry[]
  initialFields: PlacedField[]
  initialRecipient: EditorRecipient | null
}) {
  const [fields, setFields] = useState<PlacedField[]>(initialFields)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const selected = fields.find((f) => f.id === selectedId) ?? null

  // ---- autosave -----------------------------------------------------------
  // Debounced, and skipped on the first render so opening the editor does not
  // immediately write back what it just read.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }

    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: fields }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          setSaveError(data?.error?.message ?? 'השמירה נכשלה.')
          setSaveState('error')
          return
        }
        setSaveError(null)
        setSaveState('saved')
      } catch {
        setSaveError('השמירה נכשלה. בדקו את החיבור לאינטרנט.')
        setSaveState('error')
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [fields, documentId])

  // ---- field operations ---------------------------------------------------

  const addField = useCallback(
    (type: FieldType, page: number, at?: { x: number; y: number }) => {
      const spec = FIELD_TYPES.find((f) => f.type === type)!
      const id = crypto.randomUUID()

      // Dropped where the pointer was, centred on it. Without a drop point
      // (toolbar click) it lands mid-page, never at 0,0 where the page edge
      // would hide it.
      const x = at ? at.x - spec.defaultWidth / 2 : 0.5 - spec.defaultWidth / 2
      const y = at ? at.y - spec.defaultHeight / 2 : 0.45

      setFields((current) => [
        ...current,
        {
          id,
          type,
          label: spec.label,
          // A signature is always the signer's; everything else defaults to us,
          // because most fields on a supplier agreement are details we know.
          ownedBy: type === 'signature' ? 'signer' : 'sender',
          required: true,
          page,
          ...clampToPage({ x, y, width: spec.defaultWidth, height: spec.defaultHeight }),
          value: null,
          options: type === 'select' ? ['אפשרות 1', 'אפשרות 2'] : null,
        },
      ])
      setSelectedId(id)
    },
    [],
  )

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
        // Offset so the copy is visibly a second field, not hidden underneath.
        ...clampToPage({ ...source, x: source.x + 0.02, y: source.y + 0.03 }),
      }
      return [...current, copy]
    })
  }, [])

  // Delete/Backspace removes the selected field, but never while a text input
  // has focus — otherwise typing in the label field deletes the field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable]')) return

      if (event.key === 'Escape') setSelectedId(null)
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        deleteField(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, deleteField])

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <FieldToolbar
        onAdd={(type) => addField(type, 1)}
        saveState={saveState}
        saveError={saveError}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-4">
          {pages.map((page) => (
            <EditorPage
              key={page.pageNumber}
              documentId={documentId}
              page={page}
              fields={fields.filter((f) => f.page === page.pageNumber)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUpdate={updateField}
              onAdd={(type, at) => addField(type, page.pageNumber, at)}
            />
          ))}
        </div>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        {selected ? (
          <FieldPanel
            field={selected}
            onChange={(patch) => updateField(selected.id, patch)}
            onDelete={() => deleteField(selected.id)}
            onDuplicate={() => duplicateField(selected.id)}
          />
        ) : (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-muted">
            בחרו שדה כדי לערוך אותו, או גררו שדה חדש מהרשימה.
          </p>
        )}

        <RecipientForm documentId={documentId} initial={initialRecipient} />
      </aside>
    </div>
  )
}

/**
 * One page plus the fields on it.
 *
 * The page box gets its aspect ratio from the page's own measured pixel size,
 * so the container is always exactly the shape of the real page. Field
 * fractions then map onto it with no assumption about what that shape is.
 */
function EditorPage({
  documentId,
  page,
  fields,
  selectedId,
  onSelect,
  onUpdate,
  onAdd,
}: {
  documentId: string
  page: PageGeometry
  fields: PlacedField[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<PlacedField>) => void
  onAdd: (type: FieldType, at?: { x: number; y: number }) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div className="relative">
      <div
        ref={ref}
        className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow)]"
        // The real ratio, from the page's own measured size in points.
        style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
        onPointerDown={(event) => {
          // A click on the page background clears the selection; a click that
          // started on a field is stopped by the field itself.
          if (event.target === event.currentTarget || event.target instanceof HTMLImageElement) {
            onSelect(null)
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const type = event.dataTransfer.getData('application/x-xtra-field') as FieldType
          if (!type) return

          const rect = ref.current?.getBoundingClientRect()
          if (!rect) return

          // Drop point as a fraction of the page, taken from the element's own
          // box — no assumption about how wide it happens to be rendered.
          onAdd(type, {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height,
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

        {fields.map((field) => (
          <FieldBox
            key={field.id}
            field={field}
            selected={field.id === selectedId}
            containerRef={ref}
            onSelect={() => onSelect(field.id)}
            onUpdate={(patch) => onUpdate(field.id, patch)}
          />
        ))}
      </div>

      <p className="mt-1 text-center text-xs text-muted">
        עמוד {page.pageNumber}
      </p>
    </div>
  )
}
