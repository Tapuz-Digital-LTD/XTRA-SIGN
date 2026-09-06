import { PDFDocument, PDFTextField, type PDFWidgetAnnotation } from 'pdf-lib'
import { clampToPage, type FieldType, type PlacedField } from '@/lib/fields'
import { log } from '@/server/log'

/**
 * A fillable PDF brings its own layout.
 *
 * Whoever built the form already decided where the business name goes and how
 * wide the box is. Those widget rectangles become our fields, keyed by the
 * form's own field names, so a document made from a Ministry template can be
 * filled by name rather than by someone re-placing eight boxes by eye.
 *
 * The form is then flattened. Two reasons: a widget annotation is drawn on top
 * of the page by every viewer, so a value we stamp into the page underneath it
 * would be hidden by the widget's own white background; and an interactive
 * form on a document we are about to sign invites edits that never reach us.
 * Flattening draws the widgets' current appearance (the empty boxes) into the
 * page content — visually identical, verified against the original render.
 */

export type AcroFormIntake = { fields: PlacedField[]; flattened: Buffer }

export type IntakePage = { page: number; widthPt: number; heightPt: number }

/**
 * A 17pt text box is what a form designer draws for a name. A signature drawn
 * with a finger needs several times that to stay legible, so a signature field
 * grows downwards from the box's top edge into the space below it — never
 * upwards, where the box's label sits.
 */
const SIGNATURE_MIN_HEIGHT = 0.055

export async function intakeAcroForm(bytes: Buffer, pages: IntakePage[]): Promise<AcroFormIntake | null> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })

  let form: ReturnType<PDFDocument['getForm']>
  try {
    form = pdf.getForm()
  } catch {
    return null
  }
  const formFields = form.getFields()
  if (formFields.length === 0) return null

  const pageRefs = pdf.getPages().map((page) => page.ref)
  const usedKeys: string[] = []
  const fields: PlacedField[] = []

  for (const formField of formFields) {
    // Text boxes only. A checkbox or a dropdown on a form we are handed is
    // kept as drawn (it is flattened with everything else) but not turned into
    // a field — a checkbox drawn as already ticked is a statement, not a
    // question.
    if (!(formField instanceof PDFTextField)) continue

    const widget = formField.acroField.getWidgets()[0]
    if (!widget) continue

    const pageIndex = pageIndexOf(widget, pageRefs)
    const geometry = pages.find((p) => p.page === pageIndex + 1)
    if (!geometry) continue

    const rect = widget.getRectangle()
    const key = variableKeyFor(formField.getName(), usedKeys)
    usedKeys.push(key)
    const type = typeFor(key)

    const box = {
      x: rect.x / geometry.widthPt,
      // PDF's origin is bottom-left; ours is top-left.
      y: (geometry.heightPt - rect.y - rect.height) / geometry.heightPt,
      width: rect.width / geometry.widthPt,
      height: rect.height / geometry.heightPt,
    }
    if (type === 'signature') box.height = Math.max(box.height, SIGNATURE_MIN_HEIGHT)

    fields.push({
      id: crypto.randomUUID(),
      type,
      label: formField.getName(),
      // The signature is the signer's. Every other box is ours to fill before
      // sending — including the date, which the system stamps at signing
      // (the editor's own "אוטומטי" convention: sender-owned, autoFill).
      ownedBy: type === 'signature' ? 'signer' : 'sender',
      required: true,
      page: pageIndex + 1,
      ...clampToPage(box),
      value: null,
      options: null,
      placeholder: null,
      autoFill: type === 'date',
      autoSource: null,
      variableKey: key,
    })
  }

  try {
    form.flatten()
  } catch (error) {
    // An appearance stream pdf-lib cannot regenerate (a font it does not
    // hold) is not a reason to keep the widgets live.
    log.warn('acroform flatten fell back to existing appearances', { error: String(error) })
    form.flatten({ updateFieldAppearances: false })
  }

  return { fields, flattened: Buffer.from(await pdf.save()) }
}

function pageIndexOf(widget: PDFWidgetAnnotation, pageRefs: { toString(): string }[]): number {
  const ref = widget.P()
  if (ref) {
    const index = pageRefs.findIndex((pageRef) => pageRef === ref || pageRef.toString() === ref.toString())
    if (index >= 0) return index
  }
  return 0
}

/** What a box is for, read off its name — the only hint a form gives. */
function typeFor(key: string): FieldType {
  // "signature_date" is a date; "authorized_signatory" is a name. Only the
  // whole word "signature" means a signature.
  if (key.includes('date')) return 'date'
  if (/(^|_)signature(_|$)/.test(key)) return 'signature'
  if (key.includes('email') || key.includes('mail')) return 'email'
  if (key.includes('phone') || key.includes('tel') || key.includes('mobile')) return 'phone'
  return 'text'
}

function variableKeyFor(name: string, existing: string[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
