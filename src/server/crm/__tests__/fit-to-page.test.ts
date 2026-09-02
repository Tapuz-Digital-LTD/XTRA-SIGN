import { describe, expect, it } from 'vitest'
import { renderHtmlToPdf } from '@/server/crm/html-to-pdf'

const pageCount = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

// 40 paragraphs of Hebrew, set at the 20px the supplier template uses.
const body = Array.from({ length: 40 }, (_, i) =>
  `<p style="font-size:20px">פסקה ${i + 1} של הסכם ההתקשרות בין הצדדים, עם מספיק טקסט כדי לגלוש לשורה נוספת בכל רוחב סביר.</p>`,
).join('')

describe('renderHtmlToPdf fit-to-page', () => {
  it('shrinks a template drawn on a canvas wider than the page', async () => {
    const wide = await renderHtmlToPdf(`<div style="width:1000px">${body}</div>`)
    const atPageWidth = await renderHtmlToPdf(`<div style="width:700px">${body}</div>`)

    // The same content, designed wide, must not cost more pages than the same
    // content designed at page width — that inflation is the bug.
    expect(pageCount(wide)).toBeLessThanOrEqual(pageCount(atPageWidth))
  }, 120_000)
})
