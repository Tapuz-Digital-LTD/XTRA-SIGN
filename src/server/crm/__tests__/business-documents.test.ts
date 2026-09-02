import { describe, expect, it } from 'vitest'
import { expandLineItems } from '../business-documents'

/**
 * Line items are a collection, not a scalar token. The template's line row is
 * repeated once per item, exactly as Fireberry repeats it when printing.
 */

const TABLE = `
<table>
  <tr><th>פריט</th><th>כמות</th><th>מחיר</th></tr>
  <tr><td>{[!productname]}</td><td>{[!itemquantity]}</td><td>{[!itemprice]}</td></tr>
  <tr><td>סה"כ</td><td></td><td>{[!totalamount]}</td></tr>
</table>`

describe('expandLineItems', () => {
  it('repeats the line row once per item, in order', () => {
    const html = expandLineItems(TABLE, [
      { productname: 'אתר בחירת מתנות', itemquantity: 55, itemprice: 200 },
      { productname: 'הקמה', itemquantity: 1, itemprice: 1500 },
    ])
    expect(html).toContain('אתר בחירת מתנות')
    expect(html).toContain('הקמה')
    expect((html.match(/<td>55<\/td>/) ?? []).length).toBe(1)
    // The totals row is not a line row and must survive untouched.
    expect(html).toContain('{[!totalamount]}')
    // No item token is left behind.
    expect(html).not.toContain('{[!productname]}')
  })

  it('drops the line row when there are no items', () => {
    const html = expandLineItems(TABLE, [])
    expect(html).not.toContain('{[!productname]}')
    expect(html).toContain('סה"כ')
  })

  it('leaves a template without a line table alone', () => {
    const plain = '<p>שלום {[!accountidname]}</p>'
    expect(expandLineItems(plain, [{ productname: 'x' }])).toBe(plain)
  })

  it('escapes item values rather than trusting them as markup', () => {
    const html = expandLineItems(TABLE, [{ productname: '<script>alert(1)</script>', itemquantity: 1, itemprice: 1 }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('formats numbers the way a person reads them', () => {
    const html = expandLineItems(TABLE, [{ productname: 'x', itemquantity: 1, itemprice: 11000 }])
    expect(html).toContain('11,000')
  })
})

describe('value formatting', () => {
  it('groups money but never an identifier', () => {
    const money = expandLineItems('<table><tr><td>{[!itemprice]}</td></tr></table>', [{ itemprice: 11000 }])
    expect(money).toContain('11,000')

    // A quote number is not an amount. "1,758" would be wrong.
    const id = expandLineItems('<table><tr><td>{[!productname]}</td><td>{[!itemquantity]}</td></tr></table>', [
      { productname: 'x', itemquantity: 1758 },
    ])
    expect(id).toContain('1758')
    expect(id).not.toContain('1,758')
  })
})

describe('isCrmId', () => {
  it('accepts a GUID and refuses anything that could alter a query', async () => {
    const { isCrmId } = await import('../business-documents')
    expect(isCrmId('9054a10c-5f7f-4d01-b212-87f6272acf6d')).toBe(true)
    for (const bad of [
      '9054a10c-5f7f-4d01-b212-87f6272acf6d) or (1 = 1',
      "' or '1'='1",
      '../../etc',
      '',
      'not-a-guid',
    ]) {
      expect(isCrmId(bad)).toBe(false)
    }
  })
})
