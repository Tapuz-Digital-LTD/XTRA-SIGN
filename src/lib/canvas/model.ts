import type { FieldType } from '@/lib/fields'

/**
 * The document model behind the canvas editor.
 *
 * Positions are in millimetres on an A4 page, never in pixels. A pixel is a
 * property of the screen the author happened to use; a millimetre is a property
 * of the page, so the same number places an element identically in the editor,
 * in a preview, at any zoom, and in the printed PDF. This is what makes "what I
 * see is what comes out" a fact rather than an aspiration.
 *
 * The model is also the interface XTRA AI edits through. Every element has a
 * stable id and named properties, so "make the logo bigger and move it to the
 * top right" is one update to one element rather than a regeneration of the
 * whole document.
 */

/** A4, in millimetres. The only page size the product promises today. */
export const PAGE_WIDTH_MM = 210
export const PAGE_HEIGHT_MM = 297

/** The default text area, matching the margins the PDF renderer prints with. */
export const PAGE_MARGIN_MM = 12

export type ElementKind =
  | 'text'
  | 'image'
  | 'rect'
  | 'line'
  | 'table'
  | 'field'

/** Where an element's content comes from, when it is not typed in. */
export type Binding =
  | 'company.name'
  | 'company.tax_id'
  | 'company.address'
  | 'company.contact_name'
  | 'company.contact_phone'
  | 'company.contact_email'
  | 'organization.legal_name'
  | 'organization.tax_id'
  | 'organization.address'
  | 'organization.phone'
  | 'organization.email'
  | 'today'

export type TextStyle = {
  fontFamily?: string
  /** Points, as in a word processor. */
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  color?: string
  backgroundColor?: string
  align?: 'right' | 'center' | 'left' | 'justify'
  /** Hebrew documents default to rtl; a field of English does not have to. */
  direction?: 'rtl' | 'ltr'
  lineHeight?: number
  letterSpacing?: number
}

export type BoxStyle = {
  fill?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  opacity?: number
}

export type TableStyle = {
  headerFill?: string
  headerColor?: string
  borderColor?: string
  /** Column widths in millimetres. Missing means share the width equally. */
  columnWidths?: number[]
  fontSize?: number
}

type Base = {
  id: string
  /** Millimetres from the page's top-left, before rotation. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees clockwise. */
  rotation?: number
  /** Higher draws on top. */
  zIndex: number
  locked?: boolean
  hidden?: boolean
  /** Shown in the layers panel. */
  name?: string
}

export type TextElement = Base & {
  kind: 'text'
  text: string
  style?: TextStyle
  /** When set, the text is replaced per recipient at send time. */
  binding?: Binding
}

export type ImageElement = Base & {
  kind: 'image'
  /** A data URI or a URL the renderer may fetch. */
  src: string
  alt?: string
  /** How the image fills its box, as CSS object-fit does. */
  fit?: 'cover' | 'contain'
  style?: BoxStyle
}

export type RectElement = Base & {
  kind: 'rect'
  style?: BoxStyle
}

export type LineElement = Base & {
  kind: 'line'
  style?: BoxStyle
}

export type TableElement = Base & {
  kind: 'table'
  headers: string[]
  rows: string[][]
  style?: TableStyle
}

/** A signature, name, date or other input the signer fills. */
export type FieldElement = Base & {
  kind: 'field'
  fieldType: FieldType
  label: string
  required?: boolean
  /** Filled from the company rather than by the signer. */
  binding?: Binding
  style?: TextStyle
}

export type CanvasElement =
  | TextElement
  | ImageElement
  | RectElement
  | LineElement
  | TableElement
  | FieldElement

export type PageBackground = {
  color?: string
  /** A full-bleed image behind everything else on the page. */
  image?: string
  /** 0..1, painted over the image so text on top stays readable. */
  overlayOpacity?: number
  overlayColor?: string
}

export type CanvasPage = {
  id: string
  background?: PageBackground
  elements: CanvasElement[]
}

export type CanvasDocument = {
  /** Bumped when the shape changes in a way older readers cannot handle. */
  version: 1
  title: string
  pages: CanvasPage[]
}

export function emptyDocument(title = 'מסמך חדש'): CanvasDocument {
  return { version: 1, title, pages: [emptyPage()] }
}

export function emptyPage(): CanvasPage {
  return { id: newId(), background: { color: '#ffffff' }, elements: [] }
}

/** Short, readable, and unique enough for a document's lifetime. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Millimetres to CSS pixels at 96dpi, for the editor and the renderer alike. */
export function mmToPx(mm: number): number {
  return (mm / 25.4) * 96
}

export function pxToMm(px: number): number {
  return (px / 96) * 25.4
}

/** Keeps an element on its page, so nothing can be dragged into nowhere. */
export function clampToPage<T extends { x: number; y: number; width: number; height: number }>(
  element: T,
): T {
  const width = Math.min(Math.max(element.width, 3), PAGE_WIDTH_MM)
  const height = Math.min(Math.max(element.height, 3), PAGE_HEIGHT_MM)
  return {
    ...element,
    width,
    height,
    x: Math.min(Math.max(element.x, 0), PAGE_WIDTH_MM - width),
    y: Math.min(Math.max(element.y, 0), PAGE_HEIGHT_MM - height),
  }
}

/** The next free layer above everything currently on the page. */
export function topZIndex(page: CanvasPage): number {
  return page.elements.reduce((top, element) => Math.max(top, element.zIndex), 0) + 1
}

export function findElement(
  document: CanvasDocument,
  elementId: string,
): { page: CanvasPage; pageIndex: number; element: CanvasElement } | null {
  for (const [pageIndex, page] of document.pages.entries()) {
    const element = page.elements.find((candidate) => candidate.id === elementId)
    if (element) return { page, pageIndex, element }
  }
  return null
}
