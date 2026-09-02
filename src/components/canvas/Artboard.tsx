'use client'

import * as fabric from 'fabric'
import { useEffect, useRef } from 'react'
import {
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  mmToPx,
  pxToMm,
  type CanvasElement,
  type CanvasPage,
} from '@/lib/canvas/model'
import { applySnap, pageSizePx, readGeometry, snapTargets, toFabric, type Guide } from './fabric-bridge'

/**
 * One A4 page, drawn and edited.
 *
 * The model is the source of truth and this is a view of it: Fabric reports
 * what the mouse did, the numbers are converted back to millimetres, and the
 * document is updated. Nothing about zoom or pixels survives that trip, which
 * is what keeps a page identical in the editor and in the PDF.
 */
export function Artboard({
  page,
  pageIndex,
  zoom,
  selectedIds,
  onSelect,
  onChange,
  onCommit,
  onEditText,
}: {
  page: CanvasPage
  pageIndex: number
  zoom: number
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  /** Live during a drag — not yet a history entry. */
  onChange: (elementId: string, patch: Partial<CanvasElement>) => void
  /** The gesture finished; this is one undo step. */
  onCommit: () => void
  onEditText: (elementId: string, text: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const guidesRef = useRef<Guide[]>([])
  // Read inside Fabric's handlers, which are registered once.
  const latest = useRef({ page, zoom, onChange, onCommit, onSelect, onEditText })
  latest.current = { page, zoom, onChange, onCommit, onSelect, onEditText }

  // Create the canvas once. Re-creating it on every render would drop the
  // selection and interrupt whatever the person was doing.
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new fabric.Canvas(canvasRef.current, {
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '',
    })
    fabricRef.current = canvas

    const geometryOf = (object: fabric.FabricObject) => readGeometry(object, latest.current.zoom)

    canvas.on('object:moving', (event) => {
      const object = event.target
      const id = (object as { xtraId?: string })?.xtraId
      if (!object || !id) return

      const box = geometryOf(object)
      const { x, y, guides } = applySnap(box, snapTargets(latest.current.page, id), latest.current.zoom)
      object.set({ left: mmToPx(x) * latest.current.zoom, top: mmToPx(y) * latest.current.zoom })
      guidesRef.current = guides
      canvas.requestRenderAll()
    })

    canvas.on('object:modified', (event) => {
      const object = event.target
      const id = (object as { xtraId?: string })?.xtraId
      if (!object || !id) return

      const box = geometryOf(object)
      // Fabric resizes by scaling; the model stores a size, so the scale is
      // folded back into width and height and reset.
      object.set({ scaleX: 1, scaleY: 1, width: object.width, height: object.height })
      latest.current.onChange(id, box)
      guidesRef.current = []
      latest.current.onCommit()
    })

    canvas.on('selection:created', (event) =>
      latest.current.onSelect(
        (event.selected ?? []).map((object) => (object as { xtraId?: string }).xtraId ?? '').filter(Boolean),
      ),
    )
    canvas.on('selection:updated', (event) =>
      latest.current.onSelect(
        (event.selected ?? []).map((object) => (object as { xtraId?: string }).xtraId ?? '').filter(Boolean),
      ),
    )
    canvas.on('selection:cleared', () => latest.current.onSelect([]))

    canvas.on('text:changed', (event) => {
      const object = event.target as fabric.Textbox & { xtraId?: string }
      if (object?.xtraId) latest.current.onEditText(object.xtraId, object.text ?? '')
    })

    // The guides are drawn above everything, after Fabric has painted.
    canvas.on('after:render', () => {
      const context = canvas.getContext()
      if (!context || guidesRef.current.length === 0) return
      context.save()
      context.strokeStyle = '#ec4899'
      context.lineWidth = 1
      context.setLineDash([4, 4])
      for (const guide of guidesRef.current) {
        const at = mmToPx(guide.at) * latest.current.zoom
        context.beginPath()
        if (guide.orientation === 'v') {
          context.moveTo(at, 0)
          context.lineTo(at, canvas.getHeight())
        } else {
          context.moveTo(0, at)
          context.lineTo(canvas.getWidth(), at)
        }
        context.stroke()
      }
      context.restore()
    })

    return () => {
      void canvas.dispose()
      fabricRef.current = null
    }
  }, [])

  // Redraw whenever the page or the zoom changes.
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    let cancelled = false

    async function draw() {
      const size = pageSizePx(zoom)
      canvas!.setDimensions(size)

      canvas!.remove(...canvas!.getObjects())
      const ordered = [...page.elements].sort((a, b) => a.zIndex - b.zIndex)

      for (const element of ordered) {
        const object = await toFabric(element, zoom)
        if (cancelled || !object) continue
        ;(object as { xtraId?: string }).xtraId = element.id
        object.set({
          borderColor: '#2563eb',
          cornerColor: '#ffffff',
          cornerStrokeColor: '#2563eb',
          cornerStyle: 'circle',
          cornerSize: 10,
          transparentCorners: false,
          // Rotation only where it is meaningful; a signature box that has been
          // spun is a signature box nobody can read.
          lockRotation: element.kind === 'field',
        })
        if (element.kind === 'field') object.setControlsVisibility({ mtr: false })
        canvas!.add(object)
      }
      canvas!.requestRenderAll()
    }

    void draw()
    return () => {
      cancelled = true
    }
  }, [page, zoom])

  // Mirror the selection held above into the canvas.
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const wanted = new Set(selectedIds)
    const objects = canvas.getObjects().filter((object) => wanted.has((object as { xtraId?: string }).xtraId ?? ''))

    if (objects.length === 0) {
      canvas.discardActiveObject()
    } else if (objects.length === 1) {
      canvas.setActiveObject(objects[0])
    } else {
      canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }))
    }
    canvas.requestRenderAll()
  }, [selectedIds])

  const size = pageSizePx(zoom)
  const background = page.background

  return (
    <div
      data-page-index={pageIndex}
      className="relative shadow-lg ring-1 ring-black/10"
      style={{ width: size.width, height: size.height, background: background?.color ?? '#ffffff' }}
    >
      {/* Background and overlay sit behind the canvas so they cannot be
          selected or dragged by accident. */}
      {background?.image ? (
        <img
          src={background.image}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      ) : null}
      {background?.image && background.overlayOpacity ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: background.overlayColor ?? '#000000', opacity: background.overlayOpacity }}
        />
      ) : null}

      {/* The printable area, so an author can see the margin they are crossing. */}
      <div
        className="pointer-events-none absolute border border-dashed border-slate-300"
        style={{
          insetInlineStart: mmToPx(12) * zoom,
          insetInlineEnd: mmToPx(12) * zoom,
          top: mmToPx(12) * zoom,
          bottom: mmToPx(12) * zoom,
        }}
      />

      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
