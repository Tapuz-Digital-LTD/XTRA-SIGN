import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { intakeAcroForm } from '../acroform'
import { readPdfGeometry } from '../pdf-geometry'

/**
 * The Ministry of Tourism agreement is a fillable PDF: eight named text boxes.
 * Those boxes are the layout — the fields land exactly where the form's own
 * author put them — and the form itself is flattened so nothing sits on top of
 * the values we stamp later.
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')

const A4_PLAIN = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n',
)

describe('intakeAcroForm', () => {
  it('turns the fillable boxes into fields, keyed by their own names', async () => {
    const { pages } = await readPdfGeometry(FIXTURE)
    const result = await intakeAcroForm(FIXTURE, pages)
    expect(result).not.toBeNull()
    const { fields } = result!

    expect(fields.map((f) => f.variableKey)).toEqual([
      'business_name',
      'company_number',
      'contact_phone',
      'contact_email',
      'authorized_signatory',
      'signatory_role',
      'typed_signature',
      'signature_date',
    ])

    const name = fields.find((f) => f.variableKey === 'business_name')!
    expect(name.type).toBe('text')
    expect(name.ownedBy).toBe('sender')
    expect(name.required).toBe(true)
    expect(name.page).toBe(1)
    // The widget rectangle, as fractions of the A4 page.
    expect(name.x).toBeCloseTo(0.507, 2)
    expect(name.y).toBeCloseTo(0.221, 2)
    expect(name.width).toBeCloseTo(0.4, 2)
    expect(name.height).toBeCloseTo(0.0202, 3)

    expect(fields.find((f) => f.variableKey === 'contact_email')!.type).toBe('email')
    expect(fields.find((f) => f.variableKey === 'contact_phone')!.type).toBe('phone')
    // "signatory" is not "signature": a name and a role are text, ours to fill.
    for (const key of ['authorized_signatory', 'signatory_role', 'company_number']) {
      const field = fields.find((f) => f.variableKey === key)!
      expect(field.type, key).toBe('text')
      expect(field.ownedBy, key).toBe('sender')
    }
    expect(fields.filter((f) => f.type === 'signature')).toHaveLength(1)

    const signature = fields.find((f) => f.variableKey === 'typed_signature')!
    expect(signature.type).toBe('signature')
    expect(signature.ownedBy).toBe('signer')
    // A 17pt box cannot hold a legible signature; the field grows downwards
    // into the blank space under the box, never upwards over the label.
    expect(signature.y).toBeCloseTo(0.87, 2)
    expect(signature.height).toBeGreaterThanOrEqual(0.055)

    const date = fields.find((f) => f.variableKey === 'signature_date')!
    expect(date.type).toBe('date')
    expect(date.autoFill).toBe(true)
  })

  it('keeps where the printed radios and checkboxes are, keyed by name and state, as unvalued checkbox fields', async () => {
    // A form of our own: a text box, a radio pair and a checkbox at known places.
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842])
    const form = pdf.getForm()
    form.createTextField('name').addToPage(page, { x: 55, y: 700, width: 200, height: 17 })
    const choice = form.createRadioGroup('redemption_method')
    choice.addOptionToPage('generic_xtra25', page, { x: 539, y: 233, width: 11, height: 11 })
    choice.addOptionToPage('business_pos_code', page, { x: 539, y: 203, width: 11, height: 11 })
    form.createCheckBox('optional_extension').addToPage(page, { x: 541, y: 535, width: 11, height: 11 })
    const bytes = Buffer.from(await pdf.save())

    const { pages } = await readPdfGeometry(bytes)
    const { fields, flattened } = (await intakeAcroForm(bytes, pages))!
    expect(fields.map((f) => f.variableKey)).toEqual(['name', 'redemption_method__generic_xtra25', 'redemption_method__business_pos_code', 'optional_extension__yes'])
    const generic = fields.find((f) => f.variableKey === 'redemption_method__generic_xtra25')!
    expect(generic.type).toBe('checkbox')
    expect(generic.ownedBy).toBe('sender')
    expect(generic.required).toBe(false)
    expect(generic.value).toBeNull()
    // pdf-lib draws its radios half a point wider than asked; the box is the widget's, to the point.
    expect(generic.x).toBeCloseTo(539 / 595, 2)
    expect(generic.y).toBeCloseTo((842 - 244) / 842, 2)
    expect(generic.width).toBeCloseTo(11 / 595, 2)
    expect(fields.find((f) => f.variableKey === 'optional_extension__yes')!.y).toBeCloseTo((842 - 546) / 842, 2)
    // The widgets are gone from the file; the boxes were drawn into the page.
    expect((await PDFDocument.load(flattened)).getForm().getFields()).toHaveLength(0)
  })

  it('flattens the form without changing the page', async () => {
    const { pages } = await readPdfGeometry(FIXTURE)
    const { flattened } = (await intakeAcroForm(FIXTURE, pages))!
    const flat = await PDFDocument.load(flattened)
    expect(flat.getForm().getFields()).toHaveLength(0)
    expect(flat.getPageCount()).toBe(1)
    expect(flat.getPage(0).getSize().height).toBeCloseTo(841.89, 1)
  })

  it('is null for a PDF with no form', async () => {
    const { pages } = await readPdfGeometry(A4_PLAIN)
    expect(await intakeAcroForm(A4_PLAIN, pages)).toBeNull()
  })
})
