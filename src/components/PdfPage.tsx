'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Renders one page of a PDF into a canvas with pdf.js.
 *
 * This replaced server-side rasterisation. It is also the safer of the two ways
 * to show a PDF in a browser: pdf.js is a JavaScript parser that turns the file
 * into canvas draw calls, so a hostile document meets our own sandboxed code
 * rather than the browser's native viewer, and embedded PDF JavaScript is not
 * executed — the scripting module is simply never loaded.
 *
 * Lazy by construction: a page paints only once it is near the viewport, so a
 * fifty-page contract does not rasterise fifty pages to open.
 */

/** Backing-store width. Enough to read at full screen without being wasteful. */
const RENDER_WIDTH = 1240

let workerConfigured = false

/**
 * The `legacy` build, on purpose.
 *
 * The default build of pdf.js 6 calls `Map.prototype.getOrInsertComputed`, an
 * API that only the very newest engines ship. On anything older — Chromium
 * before 144, and the iOS Safari most signers actually open the link with —
 * every page fails with "לא הצלחנו להציג את העמוד הזה" and nothing else, which
 * is what the whole product looked like broken. The legacy build carries the
 * polyfills; the worker must be the legacy one too, since the same call runs
 * inside it.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!workerConfigured) {
    // Bundled through the app rather than fetched from a CDN: connect-src in
    // the CSP is 'self', and a worker from elsewhere would be blocked — as it
    // should be.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
    workerConfigured = true
  }
  return pdfjs
}

const documents = new Map<string, Promise<PDFDocumentProxy>>()

/**
 * One parse per document, shared by every page component.
 *
 * Without this each page would fetch and parse the whole file again, which on a
 * fifty-page document is fifty downloads of the same bytes.
 */
function openDocument(url: string): Promise<PDFDocumentProxy> {
  const existing = documents.get(url)
  if (existing) return existing

  const promise = loadPdfjs().then((pdfjs) =>
    pdfjs.getDocument({
      url,
      // The document is fetched from our own authorized route, which needs the
      // session cookie.
      withCredentials: true,
      // Draw glyphs as outlines instead of injecting an @font-face and asking
      // the browser to lay the text out. The default path substitutes a system
      // font whenever the embedded one does not load cleanly — which is what
      // smeared the Hebrew in every preview, splitting words with phantom
      // spaces because the substitute's advances did not match the positions
      // pdf.js had already computed. Outlines come straight from the embedded
      // program, so what the browser shows is exactly what the signed and
      // downloaded PDF contains.
      disableFontFace: true,
      // Non-embedded standard-14 fonts (many real supplier PDFs reference
      // Helvetica/Times without embedding them) need their metrics and outlines
      // from here, served same-origin so 'self' in the CSP covers the fetch.
      // Without it those fonts fall back to a mismatched substitute.
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      // CID/Type0 encodings (a Word "Save as PDF" in Hebrew often produces one)
      // resolve their character maps from here.
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      // pdf.js does not execute a document's embedded JavaScript unless the
      // scripting module is explicitly wired up, and nothing here does that.
    }).promise,
  )

  documents.set(url, promise)
  return promise
}

/** Drops a cached parse — call when a document is replaced by a new version. */
export function forgetPdf(url: string): void {
  documents.delete(url)
}

export function PdfPage({
  url,
  pageNumber,
  widthPt,
  heightPt,
  className,
}: {
  url: string
  pageNumber: number
  /** The page's own measured size. Reserves the exact box before it paints. */
  widthPt: number
  heightPt: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle')

  // Paints when the page comes near the viewport, and only once.
  useEffect(() => {
    const box = boxRef.current
    if (!box || state !== 'idle') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('rendering')
          observer.disconnect()
        }
      },
      // A screen ahead, so scrolling does not wait on a render.
      { rootMargin: '800px 0px' },
    )
    observer.observe(box)
    return () => observer.disconnect()
  }, [state])

  useEffect(() => {
    if (state !== 'rendering') return
    let cancelled = false

    ;(async () => {
      try {
        const pdf = await openDocument(url)
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const canvas = canvasRef.current
        if (!canvas) return

        const base = page.getViewport({ scale: 1 })
        const scale = RENDER_WIDTH / base.width
        const viewport = page.getViewport({ scale })

        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)

        const context = canvas.getContext('2d')
        if (!context) return

        await page.render({ canvas, canvasContext: context, viewport }).promise
        if (!cancelled) setState('done')
      } catch (cause) {
        // The page shows one sentence; the console keeps the reason. Without
        // this a failure here is undiagnosable — it looks identical whether
        // the fetch was refused, the file is not a PDF, or the worker failed.
        console.error(`pdf page ${pageNumber} failed to render`, cause)
        if (!cancelled) setState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state, url, pageNumber])

  return (
    <div
      ref={boxRef}
      className={className}
      // The real ratio, from the page's own measured size. Reserves exactly the
      // right space before anything paints, for any page shape.
      style={{ aspectRatio: `${widthPt} / ${heightPt}` }}
    >
      <canvas
        ref={canvasRef}
        aria-label={`עמוד ${pageNumber}`}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />
      {state === 'error' ? (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted"
        >
          לא הצלחנו להציג את העמוד הזה.
        </p>
      ) : null}
    </div>
  )
}
