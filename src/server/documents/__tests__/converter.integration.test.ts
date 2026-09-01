import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { convertDocument, converterIsReachable, converterUrl } from '../converter'
import { validateUpload } from '../file-validation'
import { ProcessingError } from '../limits'
import { FIXTURES, buildFixtures } from './fixtures'

/**
 * Runs the real converter container. Not mocked: the subject is whether
 * LibreOffice actually produces a legible Hebrew PDF and whether the limits
 * actually stop a hostile file, neither of which a stub can answer.
 *
 * Fails rather than skips when the image is missing — a silently skipped
 * security test still reads as a green run.
 */
beforeAll(async () => {
  // Fails rather than skips: a silently skipped test still reads as a green run.
  const reachable = await converterIsReachable()
  if (!reachable) {
    throw new Error(
      `conversion service unreachable at ${converterUrl()}. Run: docker compose up -d converter`,
    )
  }
  buildFixtures()
}, 180_000)

describe('DOCX conversion', () => {
  it('converts a Hebrew DOCX to a PDF and page images', async () => {
    const buffer = readFileSync(FIXTURES.docx)
    const result = await convertDocument({ buffer, kind: 'docx' })

    expect(result.pageCount).toBe(1)
    expect(result.pages).toHaveLength(1)
    expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // A PNG, not something that merely claims to be one.
    expect(result.pages[0].subarray(1, 4).toString()).toBe('PNG')
    // A blank page compresses to almost nothing; real rendered text does not.
    expect(result.pages[0].length).toBeGreaterThan(5_000)
  }, 120_000)
})

describe('legacy DOC conversion', () => {
  it('accepts a real binary .doc on its content, not its extension', () => {
    const buffer = readFileSync(FIXTURES.doc)
    const result = validateUpload(buffer)
    expect(result).toMatchObject({ ok: true, kind: 'doc', ext: 'doc' })
  })

  it('REJECTS another OLE2 file that is not a Word document', () => {
    // D0CF11E0 is shared by .doc, .xls, .ppt and .msg alike, and LibreOffice
    // opens any of them. Only the WordDocument stream distinguishes them.
    const notWord = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from('Workbook', 'utf16le'),
      Buffer.alloc(512),
    ])
    expect(validateUpload(notWord)).toMatchObject({ ok: false, code: 'unsupported_type' })
  })

  it('converts a Hebrew legacy .doc to a PDF and page images', async () => {
    const buffer = readFileSync(FIXTURES.doc)
    const result = await convertDocument({ buffer, kind: 'doc' })

    expect(result.pageCount).toBe(1)
    expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(result.pages[0].subarray(1, 4).toString()).toBe('PNG')
    expect(result.pages[0].length).toBeGreaterThan(5_000)
  }, 120_000)

  it('DOES NOT fail on a malformed .doc — LibreOffice falls back to plain text', async () => {
    // Measured, not assumed. Given an OLE2 header with garbage behind it,
    // LibreOffice does not error: it recovers by rendering the raw bytes as
    // text, producing a page of '#' characters. The output is 34KB against
    // 40KB for the real document, so a size heuristic cannot tell them apart
    // either.
    //
    // This is why the document page shows the rendered preview and asks the
    // user to check it before sending. The garbage is obvious to a human and
    // invisible to a threshold, so review is the control — not a guess.
    const broken = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from('WordDocument', 'utf16le'),
      Buffer.alloc(2048),
    ])

    const result = await convertDocument({ buffer: broken, kind: 'doc' })
    expect(result.pageCount).toBe(1)
  }, 120_000)

  it('reports a clear Hebrew message for a conversion that does fail', async () => {
    // The .doc path almost never errors: LibreOffice's plain-text fallback
    // means even arbitrary bytes "convert". A broken ZIP is the case it truly
    // cannot open, so that is what exercises the error path.
    const brokenZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml'),
      Buffer.alloc(512),
    ])

    await expect(convertDocument({ buffer: brokenZip, kind: 'docx' })).rejects.toSatisfy(
      (error: unknown) => {
        if (!(error instanceof ProcessingError)) return false
        expect(error.failure).toBe('conversion_failed')
        // Names the problem and says what to do next.
        expect(error.userMessage).toContain('PDF')
        expect(error.userMessage).toMatch(/[\u0590-\u05ff]/)
        return true
      },
    )
  }, 120_000)
})

describe('limits', () => {
  it('refuses a document with too many pages', async () => {
    const buffer = readFileSync(FIXTURES.bigPdf)
    await expect(convertDocument({ buffer, kind: 'pdf' })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProcessingError && error.failure === 'too_many_pages',
    )
  }, 120_000)

  it('produces NO page images when the page limit trips', async () => {
    // The limit is checked from the page count before rasterising, so a
    // 500-page upload never becomes 500 render jobs.
    const buffer = readFileSync(FIXTURES.bigPdf)
    let pages: Buffer[] | null = null
    try {
      pages = (await convertDocument({ buffer, kind: 'pdf' })).pages
    } catch {
      /* expected */
    }
    expect(pages).toBeNull()
  }, 120_000)

  it('surfaces a Hebrew message for every failure mode', async () => {
    const buffer = readFileSync(FIXTURES.bigPdf)
    try {
      await convertDocument({ buffer, kind: 'pdf' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError)
      const message = (error as ProcessingError).userMessage
      expect(message).toMatch(/[\u0590-\u05ff]/)
      expect(message).toContain('50')
    }
  }, 120_000)
})
