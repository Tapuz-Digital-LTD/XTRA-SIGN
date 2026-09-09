import { resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'

/**
 * Renders a PDF to pixels, page by page, so a test can look at what a person
 * would see — a tick drawn over a printed box — instead of trusting a field
 * record that says one was placed.
 *
 * pdf.js draws; @napi-rs/canvas is the surface (pdf.js picks it up in Node on
 * its own). `scale` is pixels per point: 2 gives 1190×1684 for an A4 page.
 */
export type RenderedPage = { width: number; height: number; png: Buffer; data: Uint8ClampedArray }

export async function renderPdf(bytes: Buffer, scale = 2): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // The standard-14 font data, for anything the document did not embed.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' })
  const doc = await task.promise
  const pages: RenderedPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport }).promise
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({ width: canvas.width, height: canvas.height, png: canvas.toBuffer('image/png'), data: image.data })
  }
  await task.destroy()
  return pages
}

/** A box on the page, as fractions of its width and height, origin top-left — the stamper's own coordinates. */
export type Box = { x: number; y: number; w: number; h: number }

/** How many dark pixels sit inside the box: the ink of a printed outline, plus a tick if one was drawn. */
export function ink(page: RenderedPage, box: Box): number {
  const x0 = Math.max(0, Math.floor(box.x * page.width))
  const y0 = Math.max(0, Math.floor(box.y * page.height))
  const x1 = Math.min(page.width, Math.ceil((box.x + box.w) * page.width))
  const y1 = Math.min(page.height, Math.ceil((box.y + box.h) * page.height))
  let dark = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * page.width + x) * 4
      const luma = 0.299 * page.data[i] + 0.587 * page.data[i + 1] + 0.114 * page.data[i + 2]
      if (luma < 140) dark++
    }
  }
  return dark
}
