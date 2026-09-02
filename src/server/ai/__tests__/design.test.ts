import { describe, expect, it } from 'vitest'
import { composeHtml } from '@/server/ai/tools/design'

const base = {
  title: 'הסכם השתתפות',
  sections: [],
  theme: 'tourism' as const,
  letterheadLines: ['XTRA בע"מ', 'ח.פ 123456789'],
}

describe('composeHtml', () => {
  it('escapes generated text so content cannot become markup', () => {
    const html = composeHtml({
      ...base,
      title: '<script>alert(1)</script>',
      sections: [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' }],
    })
    // What matters is that neither becomes a tag. The words survive as text,
    // which is exactly what a document quoting them should show.
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('emits a real signature field marker, not a drawn line', () => {
    const html = composeHtml({
      ...base,
      sections: [{ type: 'signature_block', fields: ['signature', 'full_name', 'date'] }],
    })
    // The renderer measures these markers to place the fields in the PDF.
    expect(html).toMatch(/data-xtra-field="signature"/)
    expect(html).toMatch(/data-xtra-field="full_name"/)
    expect(html).toMatch(/data-xtra-field="date"/)
    expect((html.match(/data-xtra-key="/g) ?? []).length).toBe(3)
  })

  it('gives every field a distinct key', () => {
    const html = composeHtml({
      ...base,
      sections: [{ type: 'signature_block', fields: ['signature', 'full_name'] }],
    })
    const keys = [...html.matchAll(/data-xtra-key="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses the brand colour over the theme when the organization has one', () => {
    const html = composeHtml({ ...base, brandPrimary: '#ff0066' })
    expect(html).toContain('#ff0066')
  })

  it('puts the organization letterhead at the top', () => {
    expect(composeHtml(base)).toContain('ח.פ 123456789')
  })

  it('emits a page break the renderer understands', () => {
    expect(composeHtml({ ...base, sections: [{ type: 'page_break' }] })).toContain('data-page-break')
  })
})
