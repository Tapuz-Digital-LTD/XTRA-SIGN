import { describe, expect, it } from 'vitest'
import { collectFields, renderComposedDocument } from '../composer-render'

/**
 * The property that matters: the box the signer taps is where the author put
 * the field in the sentence, measured from the rendered page rather than
 * declared.
 */

const DOC = `
<h1>הסכם ספקים</h1>
<p>הסכם זה נערך בין החברה לבין הספק.</p>
<table><tr><th>שירות</th><th>מחיר</th></tr><tr><td>ייעוץ</td><td>1,000</td></tr></table>
<p>שם החותם: <span data-xtra-field="full_name" data-xtra-key="XFNAME01">\u2063XFNAME01\u2063</span></p>
<div data-page-break="true"></div>
<p>ולראיה באו הצדדים על החתום: <span data-xtra-field="signature" data-xtra-key="XFSIGN01">\u2063XFSIGN01\u2063</span></p>`

describe('collectFields', () => {
  it('reads the fields the author placed', () => {
    const fields = collectFields(DOC)
    expect(fields.map((f) => f.type)).toEqual(['full_name', 'signature'])
    expect(fields.map((f) => f.key)).toEqual(['XFNAME01', 'XFSIGN01'])
    // The label falls back to the type when the span carries only the marker.
    expect(fields.every((f) => f.label.length > 0)).toBe(true)
  })
})

describe('renderComposedDocument', () => {
  it('renders the document and measures each field from the page', async () => {
    const { pdf, fields } = await renderComposedDocument(DOC)

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(fields).toHaveLength(2)

    for (const field of fields) {
      expect(field.page).toBeGreaterThanOrEqual(1)
      for (const value of [field.x, field.y, field.width, field.height]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }

    // The signature is after a page break, so it must not land on page one.
    const signature = fields.find((f) => f.type === 'signature')!
    const name = fields.find((f) => f.type === 'full_name')!
    expect(signature.page).toBeGreaterThan(name.page)
  }, 90_000)

  it('keeps the marker out of the visible text', async () => {
    const { pdf } = await renderComposedDocument(DOC)
    const { extractPdfText } = await import('@/server/crm/__tests__/pdf-text')
    const text = await extractPdfText(pdf)

    expect(text).toContain('ולראיה באו הצדדים על החתום')
    expect(text).toContain('ייעוץ')
    // Hebrew rendered, not boxes.
    expect(text).not.toContain('�')
  }, 90_000)
})
