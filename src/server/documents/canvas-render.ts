import type { PlacedField } from '@/lib/fields'
import {
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  type CanvasDocument,
  type CanvasElement,
  type CanvasPage,
  type FieldElement,
  type TextStyle,
} from '@/lib/canvas/model'
import { renderHtmlToPdf } from '@/server/crm/html-to-pdf'

/**
 * Turning a canvas document into a PDF, and into the fields that go with it.
 *
 * The page is laid out as absolutely positioned millimetres — the very numbers
 * the editor stores — so the PDF is not an approximation of the canvas, it is
 * the same coordinates rendered by a different device. Nothing is measured out
 * of the finished PDF afterwards: a field's place is known before rendering
 * begins, which is both exact and one less thing to fail.
 *
 * Text stays text rather than becoming a picture of text, so a signed agreement
 * remains searchable, selectable and accessible.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

/**
 * Every enumerated style value, checked against what we actually render.
 *
 * The model arrives from a browser and these strings are interpolated into a
 * `style` attribute. A value carrying a quote would close the attribute and let
 * the rest become markup — harmless in the PDF, where scripting is off, but
 * this same HTML is shown in previews. So nothing reaches CSS that is not one
 * of these exact words.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const ALIGNS = ['right', 'center', 'left', 'justify'] as const
const DIRECTIONS = ['rtl', 'ltr'] as const
const WEIGHTS = ['normal', 'bold'] as const
const STYLES = ['normal', 'italic'] as const
const FITS = ['cover', 'contain'] as const

/**
 * A font family reduced to a name.
 *
 * Letters, digits, spaces and hyphens only: enough for "Times New Roman", not
 * enough to close a quote or add a declaration.
 */
function safeFontFamily(value: string | undefined): string | null {
  const name = value?.replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0, 60)
  return name || null
}

/** Only colours we produced or validated ever reach a style attribute. */
function safeColor(value: string | undefined, fallback: string | null = null): string | null {
  if (!value) return fallback
  return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([\d\s.,%]+\)$/.test(value) ? value : fallback
}

function safeNumber(value: number | undefined, fallback: number, min = -10_000, max = 10_000): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(parsed, min), max)
}

function textCss(style: TextStyle | undefined): string {
  const parts = [
    `font-size:${safeNumber(style?.fontSize, 12)}pt`,
    `line-height:${safeNumber(style?.lineHeight, 1.4)}`,
    `text-align:${oneOf(style?.align, ALIGNS, 'right')}`,
    `direction:${oneOf(style?.direction, DIRECTIONS, 'rtl')}`,
    `color:${safeColor(style?.color, '#0f172a')}`,
  ]
  const family = safeFontFamily(style?.fontFamily)
  if (family) parts.push(`font-family:'${family}', 'Assistant', sans-serif`)
  if (oneOf(style?.fontWeight, WEIGHTS, 'normal') === 'bold') parts.push('font-weight:700')
  if (oneOf(style?.fontStyle, STYLES, 'normal') === 'italic') parts.push('font-style:italic')
  if (style?.underline === true) parts.push('text-decoration:underline')
  const background = safeColor(style?.backgroundColor)
  if (background) parts.push(`background:${background}`)
  if (style?.letterSpacing) parts.push(`letter-spacing:${safeNumber(style.letterSpacing, 0, -5, 20)}px`)
  return parts.join(';')
}

/** The element's box, in the page's own coordinate system. */
function frame(element: CanvasElement): string {
  const rotation = safeNumber(element.rotation, 0)
  // x measures from the LEFT edge, exactly as the canvas editor stores it.
  // The page's text direction is rtl, but a coordinate system that flips
  // between the editor and the renderer would put every element — and every
  // signature box — on the wrong side of the page.
  return [
    'position:absolute',
    `left:${safeNumber(element.x, 0, -PAGE_WIDTH_MM, PAGE_WIDTH_MM)}mm`,
    `top:${safeNumber(element.y, 0, -PAGE_HEIGHT_MM, PAGE_HEIGHT_MM)}mm`,
    `width:${safeNumber(element.width, 40, 0, PAGE_WIDTH_MM)}mm`,
    `height:${safeNumber(element.height, 10, 0, PAGE_HEIGHT_MM)}mm`,
    `z-index:${safeNumber(element.zIndex, 0, 0, 10_000)}`,
    rotation ? `transform:rotate(${rotation}deg);transform-origin:center` : '',
  ]
    .filter(Boolean)
    .join(';')
}

function renderElement(element: CanvasElement): string {
  if (element.hidden) return ''
  const box = frame(element)

  switch (element.kind) {
    case 'text':
      return `<div style="${box};${textCss(element.style)};overflow:hidden;white-space:pre-wrap;">${escapeHtml(
        element.text,
      )}</div>`

    case 'image':
      return `<img src="${escapeHtml(element.src)}" alt="${escapeHtml(element.alt ?? '')}" style="${box};object-fit:${oneOf(
        element.fit,
        FITS,
        'cover',
      )};opacity:${safeNumber(element.style?.opacity, 1, 0, 1)};border-radius:${safeNumber(
        element.style?.borderRadius,
        0,
        0,
        100,
      )}mm;" />`

    case 'rect': {
      const border = safeColor(element.style?.borderColor)
      return `<div style="${box};background:${safeColor(element.style?.fill, 'transparent')};${
        border ? `border:${safeNumber(element.style?.borderWidth, 0.3, 0, 50)}mm solid ${border};` : ''
      }border-radius:${safeNumber(element.style?.borderRadius, 0, 0, 100)}mm;opacity:${safeNumber(
        element.style?.opacity,
        1,
        0,
        1,
      )};"></div>`
    }

    case 'line':
      return `<div style="${box};background:${safeColor(element.style?.fill, '#0f172a')};opacity:${safeNumber(
        element.style?.opacity,
        1,
        0,
        1,
      )};"></div>`

    case 'table': {
      const headerFill = safeColor(element.style?.headerFill, '#f1f5f9')
      const borderColor = safeColor(element.style?.borderColor, '#94a3b8')
      const size = safeNumber(element.style?.fontSize, 10)
      const columns = element.style?.columnWidths
      const colgroup = columns?.length
        ? `<colgroup>${columns
            .map((width) => `<col style="width:${safeNumber(width, 20, 1, PAGE_WIDTH_MM)}mm" />`)
            .join('')}</colgroup>`
        : ''

      return `<div style="${box};overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:${size}pt;direction:rtl;">
          ${colgroup}
          <thead><tr>${element.headers
            .map(
              (header) =>
                `<th style="border:1px solid ${borderColor};background:${headerFill};color:${safeColor(
                  element.style?.headerColor,
                  '#0f172a',
                )};padding:1.5mm;text-align:right;">${escapeHtml(header)}</th>`,
            )
            .join('')}</tr></thead>
          <tbody>${element.rows
            .map(
              (row) =>
                `<tr>${row
                  .map(
                    (cell) =>
                      `<td style="border:1px solid ${borderColor};padding:1.5mm;text-align:right;vertical-align:top;">${escapeHtml(
                        cell,
                      )}</td>`,
                  )
                  .join('')}</tr>`,
            )
            .join('')}</tbody>
        </table>
      </div>`
    }

    case 'field':
      // Drawn as the blank a reader expects. Its position is already known, so
      // unlike the older composer nothing has to be found in the PDF text.
      return `<div style="${box};${textCss(element.style)};border-bottom:0.4mm solid #334155;"></div>`

    default:
      return ''
  }
}

function renderPage(page: CanvasPage, index: number): string {
  const background = page.background
  const layers: string[] = []

  if (background?.image) {
    layers.push(
      `<img src="${escapeHtml(background.image)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;" />`,
    )
    if (background.overlayOpacity) {
      layers.push(
        `<div style="position:absolute;inset:0;background:${safeColor(
          background.overlayColor,
          '#000000',
        )};opacity:${Math.min(Math.max(background.overlayOpacity, 0), 1)};z-index:1;"></div>`,
      )
    }
  }

  const elements = [...page.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(renderElement)
    .join('\n')

  return `<div class="page" style="${index > 0 ? 'break-before:page;' : ''}position:relative;width:${PAGE_WIDTH_MM}mm;height:${PAGE_HEIGHT_MM}mm;overflow:hidden;background:${safeColor(
    background?.color,
    '#ffffff',
  )};">${layers.join('')}${elements}</div>`
}

export function documentToHtml(document: CanvasDocument): string {
  return document.pages.map(renderPage).join('\n')
}

/**
 * The signature fields, taken straight from the model.
 *
 * Fractions of the page rather than millimetres, because that is what the
 * signing screens and the signed-PDF writer already speak.
 */
export function documentFields(document: CanvasDocument): PlacedField[] {
  const fields: PlacedField[] = []

  document.pages.forEach((page, pageIndex) => {
    for (const element of page.elements) {
      if (element.kind !== 'field' || element.hidden) continue
      const field = element as FieldElement
      fields.push({
        id: field.id,
        type: field.fieldType,
        label: field.label,
        ownedBy: field.binding ? 'sender' : 'signer',
        required: field.required !== false,
        page: pageIndex + 1,
        x: field.x / PAGE_WIDTH_MM,
        y: field.y / PAGE_HEIGHT_MM,
        width: field.width / PAGE_WIDTH_MM,
        height: field.height / PAGE_HEIGHT_MM,
        value: null,
        options: null,
        placeholder: null,
        autoFill: false,
        autoSource: field.binding ?? null,
      })
    }
  })

  return fields
}

export type RenderedCanvas = { pdf: Buffer; fields: PlacedField[] }

export async function renderCanvasDocument(document: CanvasDocument): Promise<RenderedCanvas> {
  const pdf = await renderHtmlToPdf(
    `<style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0; padding: 0; direction: rtl; }
      body { font-family: 'Assistant', sans-serif; color: #0f172a; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    </style>${documentToHtml(document)}`,
    { fitToPage: false, margin: '0' },
  )

  return { pdf, fields: documentFields(document) }
}
