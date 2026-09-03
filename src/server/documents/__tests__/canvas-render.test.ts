import { describe, expect, it } from 'vitest'
import { documentFields, documentToHtml } from '@/server/documents/canvas-render'
import { PAGE_HEIGHT_MM, PAGE_WIDTH_MM, type CanvasDocument } from '@/lib/canvas/model'

const doc: CanvasDocument = {
  version: 1,
  title: 'הסכם',
  pages: [
    {
      id: 'p1',
      background: { color: '#ffffff' },
      elements: [
        { id: 'title', kind: 'text', x: 20, y: 20, width: 170, height: 15, zIndex: 2, text: 'הסכם התקשרות' },
        {
          id: 'sig',
          kind: 'field',
          x: 20,
          y: 250,
          width: 60,
          height: 12,
          zIndex: 3,
          fieldType: 'signature',
          label: 'חתימה',
        },
      ],
    },
    { id: 'p2', elements: [] },
  ],
}

describe('canvas render', () => {
  it('places an element at the millimetres the model stores', () => {
    const html = documentToHtml(doc)
    expect(html).toContain('left:20mm')
    expect(html).toContain('top:20mm')
    expect(html).toContain('width:170mm')
  })

  it('gives every page the exact A4 box', () => {
    const html = documentToHtml(doc)
    expect(html).toContain(`width:${PAGE_WIDTH_MM}mm`)
    expect(html).toContain(`height:${PAGE_HEIGHT_MM}mm`)
  })

  it('breaks to a new page for each page after the first', () => {
    expect((documentToHtml(doc).match(/break-before:page/g) ?? []).length).toBe(1)
  })

  it('turns a field element into a placed field on the right page', () => {
    const [field] = documentFields(doc)
    expect(field.type).toBe('signature')
    expect(field.page).toBe(1)
    expect(field.x).toBeCloseTo(20 / PAGE_WIDTH_MM, 6)
    expect(field.y).toBeCloseTo(250 / PAGE_HEIGHT_MM, 6)
    expect(field.width).toBeCloseTo(60 / PAGE_WIDTH_MM, 6)
  })

  it('escapes text so document content cannot become markup', () => {
    const html = documentToHtml({
      ...doc,
      pages: [
        {
          id: 'p',
          elements: [
            { id: 't', kind: 'text', x: 0, y: 0, width: 50, height: 10, zIndex: 1, text: '<script>x</script>' },
          ],
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('refuses a colour that is not a colour', () => {
    const html = documentToHtml({
      ...doc,
      pages: [
        {
          id: 'p',
          elements: [
            {
              id: 'r',
              kind: 'rect',
              x: 0, y: 0, width: 50, height: 10, zIndex: 1,
              style: { fill: 'red;position:fixed;top:0' },
            },
          ],
        },
      ],
    })
    expect(html).not.toContain('position:fixed')
  })

  it('omits a hidden element entirely', () => {
    const html = documentToHtml({
      ...doc,
      pages: [
        {
          id: 'p',
          elements: [
            { id: 'h', kind: 'text', x: 0, y: 0, width: 50, height: 10, zIndex: 1, text: 'סודי', hidden: true },
          ],
        },
      ],
    })
    expect(html).not.toContain('סודי')
  })
})

describe('canvas render — untrusted input', () => {
  const withStyle = (style: unknown) =>
    documentToHtml({
      version: 1,
      title: 't',
      pages: [
        {
          id: 'p',
          elements: [
            {
              id: 'e',
              kind: 'text',
              x: 0, y: 0, width: 50, height: 10, zIndex: 1,
              text: 'שלום',
              style: style as never,
            },
          ],
        },
      ],
    })

  it('refuses an alignment that is not an alignment', () => {
    // Would otherwise close the style attribute and inject markup.
    const html = withStyle({ align: 'right;position:fixed" onload="alert(1)' })
    expect(html).not.toContain('onload')
    expect(html).not.toContain('position:fixed')
    // Falls back to the default rather than echoing the attacker's string.
    expect(html).toContain('text-align:right;')
  })

  it('strips everything but a name out of a font family', () => {
    const html = withStyle({ fontFamily: "Arial'; background:url(http://evil/x); font-family:'x" })
    // The words survive as an inert font name; what must not survive is any
    // character that could end the value or start a new declaration.
    const family = html.match(/font-family:'([^']*)'/)?.[1] ?? ''
    expect(family).not.toMatch(/[;:()'"]/)
    expect(html).not.toContain('url(')
    expect(html).toMatch(/font-family:'[A-Za-z0-9 -]+'/)
  })

  it('refuses a direction that is not a direction', () => {
    expect(withStyle({ direction: 'rtl;transform:scale(9)' })).not.toContain('scale(9)')
  })

  it('clamps opacity so an element cannot be pushed out of range', () => {
    const html = documentToHtml({
      version: 1,
      title: 't',
      pages: [
        {
          id: 'p',
          elements: [
            { id: 'r', kind: 'rect', x: 0, y: 0, width: 10, height: 10, zIndex: 1, style: { opacity: 99 } },
          ],
        },
      ],
    })
    expect(html).toContain('opacity:1')
  })
})
