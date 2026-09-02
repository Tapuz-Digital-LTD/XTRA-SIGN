import { describe, expect, it } from 'vitest'
import { renderHtmlToPdf } from '../html-to-pdf'
import { extractPdfText } from './pdf-text'

/**
 * These launch a real browser, so they are slower than the rest of the suite.
 * They are worth it: the failure they exist to catch — Hebrew rendering as
 * boxes because the serverless Chromium ships no Hebrew font — produces a PDF
 * that is valid, correctly sized, and completely unusable.
 */

describe('renderHtmlToPdf', () => {
  it('produces a valid PDF', async () => {
    const pdf = await renderHtmlToPdf('<p>hello</p>')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(500)
  }, 60_000)

  it('renders Hebrew as extractable text, not boxes', async () => {
    const pdf = await renderHtmlToPdf(
      '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif">הסכם ספקים — תפוזנט בע"מ</div>',
    )
    const text = await extractPdfText(pdf)
    expect(text).toContain('הסכם ספקים')
    expect(text).toContain('תפוזנט')
  }, 60_000)

  it('keeps a table and its inline styling', async () => {
    const pdf = await renderHtmlToPdf(
      '<table><tr><td style="color:red">מוצר</td><td>מחיר</td></tr></table>',
    )
    const text = await extractPdfText(pdf)
    expect(text).toContain('מוצר')
    expect(text).toContain('מחיר')
  }, 60_000)

  it('paginates a long document', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `<p>שורה מספר ${i}</p>`).join('')
    const pdf = await renderHtmlToPdf(long)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false })
    const doc = await task.promise
    expect(doc.numPages).toBeGreaterThan(1)
    await task.destroy()
  }, 60_000)

  it('does not execute script in the template', async () => {
    // Scripting is off, so this document renders its original text.
    const pdf = await renderHtmlToPdf('<p id="t">לפני</p><script>document.getElementById("t").textContent="אחרי"</script>')
    const text = await extractPdfText(pdf)
    expect(text).toContain('לפני')
    expect(text).not.toContain('אחרי')
  }, 60_000)

  it('does not fetch anything while rendering', async () => {
    // A src that would hang forever if it were actually requested.
    const pdf = await renderHtmlToPdf('<p>טקסט</p><img src="https://10.255.255.1/never.png">')
    const text = await extractPdfText(pdf)
    expect(text).toContain('טקסט')
  }, 60_000)
})
