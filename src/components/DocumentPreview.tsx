'use client'

import { PdfPage } from '@/components/PdfPage'
import { PreviewField } from '@/components/PreviewViewer'
import type { PlacedField } from '@/lib/fields'

/**
 * The document, rendered by pdf.js in the browser.
 *
 * Not an <embed> of the PDF: pdf.js parses the file into canvas draw calls with
 * our own sandboxed code and never executes JavaScript embedded in the
 * document, so a hostile file never reaches the browser's native viewer.
 * Pages paint lazily as they come into view.
 *
 * The placed fields are drawn over the page. They live beside the PDF rather
 * than inside it until the document is signed, so without this overlay someone
 * who has just laid out a signature box comes back to this screen and sees an
 * unchanged file — which reads as the work having been lost.
 */
export function DocumentPreview({
  documentId,
  pages,
  fields = [],
}: {
  documentId: string
  pages: { pageNumber: number; widthPt: number; heightPt: number }[]
  fields?: PlacedField[]
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
        >
          {fields
            .filter((field) => field.page === page.pageNumber)
            .map((field) => (
              <PreviewField key={field.id} field={field} signerView={false} />
            ))}
        </PdfPage>
      ))}
    </div>
  )
}
