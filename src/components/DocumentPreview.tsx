'use client'

import { PdfPage } from '@/components/PdfPage'

/**
 * The document, rendered by pdf.js in the browser.
 *
 * Not an <embed> of the PDF: pdf.js parses the file into canvas draw calls with
 * our own sandboxed code and never executes JavaScript embedded in the
 * document, so a hostile file never reaches the browser's native viewer.
 * Pages paint lazily as they come into view.
 */
export function DocumentPreview({
  documentId,
  pages,
}: {
  documentId: string
  pages: { pageNumber: number; widthPt: number; heightPt: number }[]
}) {
  return (
    <div className="flex flex-col gap-4">
      {pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          url={`/api/documents/${documentId}/file`}
          pageNumber={page.pageNumber}
          widthPt={page.widthPt}
          heightPt={page.heightPt}
          className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow)]"
        />
      ))}
    </div>
  )
}
