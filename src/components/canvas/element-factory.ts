import { newId, topZIndex, type CanvasElement, type CanvasPage } from '@/lib/canvas/model'
import type { FieldType } from '@/lib/fields'

/**
 * The elements the sidebar can add, with sizes that look deliberate.
 *
 * A new element lands near the top of the page's text area rather than at the
 * origin, because something dropped in the corner reads as a mistake.
 */

const DROP_X = 20
const DROP_Y = 30

type Factory = (page: CanvasPage) => CanvasElement

const base = (page: CanvasPage) => ({
  id: newId(),
  x: DROP_X,
  y: DROP_Y,
  zIndex: topZIndex(page),
})

export const TEXT_PRESETS: Record<string, Factory> = {
  heading: (page) => ({
    ...base(page),
    kind: 'text',
    width: 170,
    height: 16,
    text: 'כותרת ראשית',
    name: 'כותרת',
    style: { fontSize: 24, fontWeight: 'bold', align: 'right', direction: 'rtl' },
  }),
  subheading: (page) => ({
    ...base(page),
    kind: 'text',
    width: 170,
    height: 12,
    text: 'כותרת משנה',
    name: 'כותרת משנה',
    style: { fontSize: 16, fontWeight: 'bold', align: 'right', direction: 'rtl' },
  }),
  body: (page) => ({
    ...base(page),
    kind: 'text',
    width: 170,
    height: 25,
    text: 'כתבו כאן את תוכן המסמך.',
    name: 'טקסט',
    style: { fontSize: 12, align: 'right', direction: 'rtl' },
  }),
}

export const SHAPE_PRESETS: Record<string, Factory> = {
  rect: (page) => ({
    ...base(page),
    kind: 'rect',
    width: 60,
    height: 40,
    name: 'מלבן',
    style: { fill: '#e2e8f0', borderRadius: 2 },
  }),
  circle: (page) => ({
    ...base(page),
    kind: 'rect',
    width: 40,
    height: 40,
    name: 'עיגול',
    // A circle is a rectangle whose radius is half its side; one shape kind
    // fewer to render, style and validate everywhere else.
    style: { fill: '#e2e8f0', borderRadius: 20 },
  }),
  line: (page) => ({
    ...base(page),
    kind: 'line',
    width: 170,
    height: 0.5,
    name: 'קו',
    style: { fill: '#94a3b8' },
  }),
}

export function tableElement(page: CanvasPage): CanvasElement {
  return {
    ...base(page),
    kind: 'table',
    width: 170,
    height: 40,
    name: 'טבלה',
    headers: ['מוצר / שירות', 'כמות', 'מחיר'],
    rows: [
      ['', '', ''],
      ['', '', ''],
    ],
    style: { headerFill: '#f1f5f9', borderColor: '#94a3b8', fontSize: 10 },
  }
}

export function imageElement(page: CanvasPage, src: string, name = 'תמונה'): CanvasElement {
  return { ...base(page), kind: 'image', width: 60, height: 40, src, name, fit: 'contain' }
}

/** The signer inputs, sized so each is comfortable to sign or type into. */
export const FIELD_PRESETS: { type: FieldType; label: string; width: number; height: number }[] = [
  { type: 'signature', label: 'חתימה', width: 55, height: 18 },
  { type: 'full_name', label: 'שם מלא', width: 55, height: 9 },
  { type: 'date', label: 'תאריך', width: 35, height: 9 },
  { type: 'text', label: 'טקסט', width: 55, height: 9 },
  { type: 'checkbox', label: 'סימון', width: 8, height: 8 },
  { type: 'email', label: 'אימייל', width: 60, height: 9 },
  { type: 'phone', label: 'טלפון', width: 45, height: 9 },
  { type: 'number', label: 'מספר', width: 30, height: 9 },
]

export function fieldElement(page: CanvasPage, type: FieldType): CanvasElement {
  const preset = FIELD_PRESETS.find((candidate) => candidate.type === type) ?? FIELD_PRESETS[0]
  return {
    ...base(page),
    kind: 'field',
    width: preset.width,
    height: preset.height,
    fieldType: preset.type,
    label: preset.label,
    name: preset.label,
    required: true,
  }
}
