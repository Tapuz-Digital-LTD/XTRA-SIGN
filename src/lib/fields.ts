import type { fieldType } from '@/server/db/schema'

export type FieldType = (typeof fieldType.enumValues)[number]
export type FieldOwner = 'sender' | 'signer'

/**
 * The nine field types, in the order they appear in the toolbar.
 *
 * Nine, not thirty. Every extra type is one more decision for someone who just
 * wants a signature on a supplier agreement.
 */
export const FIELD_TYPES: {
  type: FieldType
  label: string
  icon: string
  /** Default size as a fraction of page width/height. */
  defaultWidth: number
  defaultHeight: number
}[] = [
  { type: 'signature', label: 'חתימה', icon: '✒️', defaultWidth: 0.28, defaultHeight: 0.06 },
  { type: 'full_name', label: 'שם מלא', icon: '👤', defaultWidth: 0.24, defaultHeight: 0.035 },
  { type: 'text', label: 'טקסט', icon: '¶', defaultWidth: 0.24, defaultHeight: 0.035 },
  { type: 'number', label: 'מספר', icon: '#', defaultWidth: 0.14, defaultHeight: 0.035 },
  { type: 'date', label: 'תאריך', icon: '📅', defaultWidth: 0.18, defaultHeight: 0.035 },
  { type: 'checkbox', label: 'תיבת סימון', icon: '☑', defaultWidth: 0.05, defaultHeight: 0.03 },
  { type: 'select', label: 'בחירה מרשימה', icon: '▾', defaultWidth: 0.24, defaultHeight: 0.035 },
  { type: 'email', label: 'אימייל', icon: '@', defaultWidth: 0.26, defaultHeight: 0.035 },
  { type: 'phone', label: 'טלפון', icon: '☎', defaultWidth: 0.2, defaultHeight: 0.035 },
]

export const FIELD_LABELS: Record<FieldType, string> = Object.fromEntries(
  FIELD_TYPES.map((f) => [f.type, f.label]),
) as Record<FieldType, string>

/** Never "field owner" on screen — the question is who fills it in. */
export const OWNER_LABELS: Record<FieldOwner, string> = {
  sender: 'אנחנו',
  signer: 'החותם',
}

export type PlacedField = {
  id: string
  type: FieldType
  label: string
  ownedBy: FieldOwner
  required: boolean
  page: number
  /**
   * Fractions of the page, 0..1, origin top-left. Never pixels: a pixel value
   * is tied to the width the editor happened to render at, so the same field
   * would land elsewhere on a phone, on a landscape page, or on Letter.
   */
  x: number
  y: number
  width: number
  height: number
  value: string | null
  options: string[] | null
  /** Hint text for a signer-filled field: a title/example separate from the value. */
  placeholder: string | null
  /** System-filled at signing (a date stamped with the signing date). */
  autoFill: boolean
}

export type PageGeometry = {
  pageNumber: number
  /**
   * The page's own size in PDF points.
   *
   * Also the aspect ratio the editor lays a page out with. There used to be a
   * separate pixel size from server-side rasterisation; the browser renders the
   * PDF itself now, so there is one source of truth and nothing to keep in sync.
   */
  widthPt: number
  heightPt: number
}

/** Keeps a field inside its page after a move or a resize. */
export function clampToPage(field: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  // A field narrower than this is impossible to grab again once dropped.
  const MIN = 0.02
  const width = Math.min(Math.max(field.width, MIN), 1)
  const height = Math.min(Math.max(field.height, MIN), 1)
  return {
    width,
    height,
    x: Math.min(Math.max(field.x, 0), 1 - width),
    y: Math.min(Math.max(field.y, 0), 1 - height),
  }
}

/**
 * Fractions to PDF points, using the page's own measured size.
 *
 * PDF's origin is bottom-left and ours is top-left, so y is flipped here. This
 * is the single place that conversion happens.
 */
export function toPdfRect(
  field: { x: number; y: number; width: number; height: number },
  page: { widthPt: number; heightPt: number },
): { x: number; y: number; width: number; height: number } {
  const width = field.width * page.widthPt
  const height = field.height * page.heightPt
  return {
    x: field.x * page.widthPt,
    y: page.heightPt - field.y * page.heightPt - height,
    width,
    height,
  }
}

/**
 * A stable `{{key}}` derived from the label the user typed.
 *
 * The user never sees or types this syntax — they see "שם החברה". The key is
 * what a CRM will later fill in, so it has to survive being generated from
 * Hebrew.
 */
export function toVariableKey(label: string, existing: string[] = []): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field'

  if (!existing.includes(base)) return base

  let n = 2
  while (existing.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
