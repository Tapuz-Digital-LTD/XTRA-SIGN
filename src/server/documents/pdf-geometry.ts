import { PDFDocument } from 'pdf-lib'
import { LIMITS, ProcessingError } from './limits'

/**
 * Reads each page's real size straight out of the PDF.
 *
 * This is what replaced the LibreOffice container. There is nothing to render
 * server-side any more: pdf-lib parses the page tree, and the browser draws the
 * pages with pdf.js when someone actually looks at them.
 *
 * The numbers are the same ones the old pipeline extracted with `pdfinfo`, and
 * they are still the thing that makes a signature land where the user put it —
 * pages in one document are not all the same size and are not necessarily A4.
 * Nothing downstream changed: `document_pages`, `toPdfRect` and the geometry
 * tests are untouched.
 */

export type PageGeometry = {
  page: number
  /** The page's own size in PDF points, measured — never assumed. */
  widthPt: number
  heightPt: number
}

export type PdfGeometry = {
  pageCount: number
  pages: PageGeometry[]
}

export async function readPdfGeometry(bytes: Buffer): Promise<PdfGeometry> {
  let pdf: PDFDocument
  try {
    // `updateMetadata: false` keeps the bytes we were given intact; this only
    // reads. `ignoreEncryption` lets a password-protected file parse far enough
    // to be refused with a clear message rather than throwing an opaque error.
    pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    })
  } catch {
    throw new ProcessingError('unreadable')
  }

  if (pdf.isEncrypted) {
    // An encrypted PDF cannot be stamped, so accepting it would mean failing
    // at signing time instead of at upload time.
    throw new ProcessingError('conversion_failed')
  }

  const count = pdf.getPageCount()
  if (count === 0) throw new ProcessingError('unreadable')

  // Checked before anything else touches the pages, exactly as the page limit
  // was checked before rasterising.
  if (count > LIMITS.MAX_PAGES) throw new ProcessingError('too_many_pages')

  const pages: PageGeometry[] = pdf.getPages().map((page, index) => {
    const { width, height } = page.getSize()
    return { page: index + 1, widthPt: width, heightPt: height }
  })

  // A page whose size cannot be read is refused rather than defaulted: a
  // guessed page size puts every field on it in the wrong place.
  if (pages.some((p) => !Number.isFinite(p.widthPt) || !Number.isFinite(p.heightPt) || p.widthPt <= 0 || p.heightPt <= 0)) {
    throw new ProcessingError('unreadable')
  }

  return { pageCount: count, pages }
}
