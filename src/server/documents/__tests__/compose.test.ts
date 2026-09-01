import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ComposeError, parseComposedText, renderComposedPdf } from '../compose'
import { validateUpload } from '../file-validation'
import { readPdfGeometry } from '../pdf-geometry'

describe('parseComposedText', () => {
  it('turns the three conventions and blank lines into blocks', () => {
    const blocks = parseComposedText(
      '# הצדדים\nהסכם זה נערך\nבין החברה לספק.\n\n- פריט ראשון\n* פריט שני\n• פריט שלישי\n---\nעמוד שני',
    )
    expect(blocks).toEqual([
      { type: 'heading', text: 'הצדדים' },
      // Consecutive lines are one paragraph; a blank line ends it.
      { type: 'paragraph', text: 'הסכם זה נערך בין החברה לספק.' },
      { type: 'bullet', text: 'פריט ראשון' },
      { type: 'bullet', text: 'פריט שני' },
      { type: 'bullet', text: 'פריט שלישי' },
      { type: 'page_break' },
      { type: 'paragraph', text: 'עמוד שני' },
    ])
  })

  it('accepts Windows line endings and ignores surrounding whitespace', () => {
    expect(parseComposedText('  # כותרת \r\n\r\n  טקסט  ')).toEqual([
      { type: 'heading', text: 'כותרת' },
      { type: 'paragraph', text: 'טקסט' },
    ])
  })

  it('treats a lone dash or hash as text, not markup', () => {
    // "-" with no space is a minus sign in a sentence; "#5" is a number.
    expect(parseComposedText('-5 מעלות\n#5 ברשימה')).toEqual([
      { type: 'paragraph', text: '-5 מעלות #5 ברשימה' },
    ])
  })
})

describe('renderComposedPdf', () => {
  it('produces a real PDF the upload pipeline accepts, with one page per break', async () => {
    const pdf = await renderComposedPdf({
      title: 'הסכם ספק',
      blocks: parseComposedText('# תנאים\nפסקה.\n- פריט\n---\nעמוד שני'),
    })

    // The same gate an uploaded file passes through.
    const validation = validateUpload(pdf)
    expect(validation.ok && validation.kind).toBe('pdf')

    const geometry = await readPdfGeometry(pdf)
    expect(geometry.pageCount).toBe(2)
    // A4, like the certificate page.
    expect(geometry.pages[0].widthPt).toBeCloseTo(595.276, 1)
    expect(geometry.pages[0].heightPt).toBeCloseTo(841.89, 1)
  })

  it('flows long text onto further pages instead of running off the bottom', async () => {
    const paragraph = 'זהו משפט ארוך למדי שנועד למלא את העמוד בטקסט בעברית, שוב ושוב, עד שיהיה צורך בעמוד נוסף. '
    const pdf = await renderComposedPdf({
      title: 'מסמך ארוך',
      blocks: parseComposedText(Array.from({ length: 40 }, () => paragraph).join('\n\n')),
    })
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('embeds a font rather than relying on the reader for Hebrew', async () => {
    const pdf = await renderComposedPdf({
      title: 'בדיקה',
      blocks: [{ type: 'paragraph', text: 'שלום' }],
    })
    // A subset of Assistant is written into the file; a standard font would
    // leave every Hebrew letter as a box. (Inside an object stream, so it is
    // found through the parsed objects rather than in the raw bytes.)
    const doc = await PDFDocument.load(pdf)
    const embedded = doc.context
      .enumerateIndirectObjects()
      .some(([, obj]) => obj instanceof PDFDict && obj.has(PDFName.of('FontFile2')))
    expect(embedded).toBe(true)
  })

  it('refuses a document that would exceed the page limit', async () => {
    const blocks = parseComposedText(Array.from({ length: 60 }, () => '---').join('\n'))
    await expect(renderComposedPdf({ title: 'יותר מדי', blocks })).rejects.toBeInstanceOf(
      ComposeError,
    )
  })
})
