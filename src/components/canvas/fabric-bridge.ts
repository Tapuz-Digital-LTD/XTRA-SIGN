import * as fabric from 'fabric'
import {
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  mmToPx,
  pxToMm,
  type CanvasElement,
  type CanvasPage,
} from '@/lib/canvas/model'

/**
 * Translating between the document model and what Fabric draws.
 *
 * Fabric works in pixels on a scaled canvas; the model works in millimetres on
 * a page. Every conversion lives here so the rest of the editor never has to
 * think about zoom — a coordinate that leaves this file is always millimetres,
 * and zoom stays what it should be: a property of the view, never of the
 * document.
 */

/** Snapping distance, in screen pixels so it feels the same at any zoom. */
const SNAP_PX = 6

export type Guide = { orientation: 'v' | 'h'; at: number }

export function pageSizePx(zoom: number): { width: number; height: number } {
  return { width: mmToPx(PAGE_WIDTH_MM) * zoom, height: mmToPx(PAGE_HEIGHT_MM) * zoom }
}

/** The object's box in millimetres, whatever Fabric has done to it. */
export function readGeometry(object: fabric.FabricObject, zoom: number) {
  return {
    x: pxToMm((object.left ?? 0) / zoom),
    y: pxToMm((object.top ?? 0) / zoom),
    width: pxToMm(((object.width ?? 0) * (object.scaleX ?? 1)) / zoom),
    height: pxToMm(((object.height ?? 0) * (object.scaleY ?? 1)) / zoom),
    rotation: object.angle ?? 0,
  }
}

function textOptions(element: Extract<CanvasElement, { kind: 'text' }>, zoom: number) {
  const style = element.style
  return {
    left: mmToPx(element.x) * zoom,
    top: mmToPx(element.y) * zoom,
    width: mmToPx(element.width) * zoom,
    angle: element.rotation ?? 0,
    // Points to pixels, then to the current zoom.
    fontSize: ((style?.fontSize ?? 12) * (96 / 72)) * zoom,
    fontFamily: style?.fontFamily || 'Assistant',
    fontWeight: style?.fontWeight === 'bold' ? 'bold' : 'normal',
    fontStyle: style?.fontStyle === 'italic' ? ('italic' as const) : ('normal' as const),
    underline: style?.underline === true,
    fill: style?.color ?? '#0f172a',
    textBackgroundColor: style?.backgroundColor ?? '',
    textAlign: style?.align ?? 'right',
    // Hebrew is the default here, and Fabric renders it natively.
    direction: (style?.direction ?? 'rtl') as CanvasDirection,
    lineHeight: style?.lineHeight ?? 1.4,
    charSpacing: (style?.letterSpacing ?? 0) * 20,
    objectCaching: false,
  }
}

/** Builds the Fabric object for one model element. */
export async function toFabric(
  element: CanvasElement,
  zoom: number,
): Promise<fabric.FabricObject | null> {
  const common = {
    left: mmToPx(element.x) * zoom,
    top: mmToPx(element.y) * zoom,
    angle: element.rotation ?? 0,
    selectable: !element.locked,
    evented: !element.locked,
    visible: element.hidden !== true,
    lockMovementX: element.locked === true,
    lockMovementY: element.locked === true,
  }

  switch (element.kind) {
    case 'text': {
      // Textbox rather than Text: it wraps inside the width the author set,
      // which is what a document element does.
      const box = new fabric.Textbox(element.text || ' ', textOptions(element, zoom))
      box.set(common)
      return box
    }

    case 'image': {
      const image = await fabric.FabricImage.fromURL(element.src, { crossOrigin: 'anonymous' }).catch(
        () => null,
      )
      if (!image) return null
      const width = mmToPx(element.width) * zoom
      const height = mmToPx(element.height) * zoom
      image.set({
        ...common,
        scaleX: width / (image.width || width),
        scaleY: height / (image.height || height),
        opacity: element.style?.opacity ?? 1,
      })
      return image
    }

    case 'rect':
    case 'field':
    case 'table': {
      const isField = element.kind === 'field'
      // Only a rectangle carries box styling; the other two are drawn as
      // placeholders here and rendered properly in the PDF.
      const boxStyle = element.kind === 'rect' ? element.style : undefined
      const rect = new fabric.Rect({
        ...common,
        width: mmToPx(element.width) * zoom,
        height: mmToPx(element.height) * zoom,
        fill: isField
          ? 'rgba(37,99,235,0.08)'
          : element.kind === 'table'
            ? 'rgba(241,245,249,0.9)'
            : (boxStyle?.fill ?? 'transparent'),
        stroke: isField ? '#2563eb' : (boxStyle?.borderColor ?? 'transparent'),
        strokeWidth: isField ? 1 : mmToPx(boxStyle?.borderWidth ?? 0) * zoom,
        strokeDashArray: isField ? [4, 3] : undefined,
        rx: mmToPx(boxStyle?.borderRadius ?? 0) * zoom,
        ry: mmToPx(boxStyle?.borderRadius ?? 0) * zoom,
        opacity: boxStyle?.opacity ?? 1,
      })
      return rect
    }

    case 'line':
      return new fabric.Rect({
        ...common,
        width: mmToPx(element.width) * zoom,
        height: Math.max(mmToPx(element.height) * zoom, 1),
        fill: element.style?.fill ?? '#0f172a',
      })

    default:
      return null
  }
}

/**
 * The lines to snap a dragged object against.
 *
 * The page's own centre and margins, plus the edges and centres of everything
 * else on the page — which is what makes aligning a logo to a heading feel
 * deliberate rather than lucky.
 */
export function snapTargets(page: CanvasPage, movingId: string): { v: number[]; h: number[] } {
  const v = [0, PAGE_WIDTH_MM / 2, PAGE_WIDTH_MM, 12, PAGE_WIDTH_MM - 12]
  const h = [0, PAGE_HEIGHT_MM / 2, PAGE_HEIGHT_MM, 12, PAGE_HEIGHT_MM - 12]

  for (const element of page.elements) {
    if (element.id === movingId || element.hidden) continue
    v.push(element.x, element.x + element.width / 2, element.x + element.width)
    h.push(element.y, element.y + element.height / 2, element.y + element.height)
  }
  return { v, h }
}

/**
 * Nudges a box onto the nearest guide.
 *
 * Compares in screen pixels so the pull feels identical whether the page is
 * shown at 50% or 150%.
 */
export function applySnap(
  box: { x: number; y: number; width: number; height: number },
  targets: { v: number[]; h: number[] },
  zoom: number,
): { x: number; y: number; guides: Guide[] } {
  const tolerance = pxToMm(SNAP_PX / zoom)
  const guides: Guide[] = []
  let { x, y } = box

  const edgesX = [
    { value: box.x, shift: 0 },
    { value: box.x + box.width / 2, shift: box.width / 2 },
    { value: box.x + box.width, shift: box.width },
  ]
  for (const edge of edgesX) {
    const hit = targets.v.find((target) => Math.abs(target - edge.value) <= tolerance)
    if (hit !== undefined) {
      x = hit - edge.shift
      guides.push({ orientation: 'v', at: hit })
      break
    }
  }

  const edgesY = [
    { value: box.y, shift: 0 },
    { value: box.y + box.height / 2, shift: box.height / 2 },
    { value: box.y + box.height, shift: box.height },
  ]
  for (const edge of edgesY) {
    const hit = targets.h.find((target) => Math.abs(target - edge.value) <= tolerance)
    if (hit !== undefined) {
      y = hit - edge.shift
      guides.push({ orientation: 'h', at: hit })
      break
    }
  }

  return { x, y, guides }
}
