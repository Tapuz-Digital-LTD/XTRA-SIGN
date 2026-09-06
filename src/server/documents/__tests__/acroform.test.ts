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
