import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlacedField } from '@/lib/fields'
import { renderHtmlToPdf } from '@/server/crm/html-to-pdf'
import { sanitizeTemplateHtml } from '@/server/crm/html-sanitize'

/**
 * Rendering an authored document, and finding where its fields landed.
 *
 * The editor puts fields inside the text, so their position on the page is
 * whatever the layout decides — which means it has to be measured, not
 * declared. Each field carries a unique marker into the PDF; the marker is then
 * located in the rendered page and becomes the field's coordinates.
 *
 * Measuring beats guessing: the author writes a sentence, and the box the
 * signer taps is exactly where that sentence ended up, at any page size, after
 * any amount of text was added above it.
 */

const FONT_PATH = join(process.cwd(), 'src/server/signing/assets/Assistant-Regular.ttf')

let fontCss: string | null = null

/** Document CSS: the page, and a Hebrew font the renderer can actually draw. */
async function documentCss(): Promise<string> {
  if (fontCss) return fontCss
  const base64 = (await readFile(FONT_PATH)).toString('base64')
  const src = `url(data:font/ttf;base64,${base64}) format('truetype')`
  fontCss = `
    @font-face { font-family: 'Assistant'; src: ${src}; font-weight: 100 900; font-display: block; }
    @font-face { font-family: 'Arial'; src: ${src}; font-weight: 100 900; font-display: block; }
    @font-face { font-family: 'Times New Roman'; src: ${src}; font-weight: 100 900; font-display: block; }
    html, body { font-family: 'Assistant', sans-serif; direction: rtl; color: #0f172a; }
    body { font-size: 12pt; line-height: 1.6; }
    h1 { font-size: 20pt; margin: 0 0 12pt; }
    h2 { font-size: 16pt; margin: 16pt 0 8pt; }
    h3 { font-size: 13pt; margin: 12pt 0 6pt; }
    p { margin: 0 0 8pt; }
    ul, ol { margin: 0 0 8pt; padding-inline-start: 20pt; }
    table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
    td, th { border: 1px solid #94a3b8; padding: 6pt; }
    th { background: #f1f5f9; font-weight: 600; }
    img { max-width: 100%; }
    tr, td, th, h1, h2, h3, li { break-inside: avoid; }
    /* The marker is measured, never read: invisible, but still in the text layer. */
    [data-xtra-field] { color: transparent; }
    /* The attribute drives the break, so it does not depend on an inline style
       surviving the editor, the sanitizer and the serialiser intact. */
    [data-page-break] { break-before: page; page-break-before: always; height: 0; }
  `
  return fontCss
}

export type RenderedDocument = { pdf: Buffer; fields: PlacedField[] }

/**
 * Renders the authored HTML and returns the PDF with its fields positioned.
 *
 * A field whose marker cannot be found in the PDF is dropped rather than placed
 * at a guessed location — a signature box in the wrong place is worse than one
 * the author is asked to place again.
 */
export async function renderComposedDocument(html: string): Promise<RenderedDocument> {
  const { html: safe } = sanitizeTemplateHtml(html)
  const css = await documentCss()
  const pdf = await renderHtmlToPdf(`<style>${css}</style>${safe}`)

  const declared = collectFields(html)
  const positions = await locateMarkers(pdf, new Set(declared.map((f) => f.key)))

  const fields: PlacedField[] = []
  for (const field of declared) {
    const at = positions.get(field.key)
    if (!at) continue
    fields.push({
      id: crypto.randomUUID(),
      type: field.type,
      label: field.label,
      ownedBy: field.type === 'signature' ? 'signer' : 'signer',
      required: true,
      page: at.page,
      x: at.x,
      y: at.y,
      width: at.width,
      height: at.height,
      value: null,
      options: null,
      placeholder: null,
      autoFill: false,
      autoSource: null,
    })
  }

  return { pdf, fields }
}

type Declared = { key: string; type: PlacedField['type']; label: string }

/** The fields the author placed, read straight out of the markup. */
export function collectFields(html: string): Declared[] {
  const found: Declared[] = []
  const pattern = /<span[^>]*data-xtra-field="([^"]+)"[^>]*data-xtra-key="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g
  for (const match of html.matchAll(pattern)) {
    const [, type, key, inner] = match
    const label = inner.replace(/<[^>]*>/g, '').replace(/[⁣]/g, '').trim()
    found.push({ key, type: type as PlacedField['type'], label: label || type })
  }
  return found
}

/**
 * Finds each marker in the rendered PDF and converts its box to page fractions.
 *
 * pdf.js gives text positions in PDF units from the bottom-left; fields are
 * stored as fractions from the top-left, which is what the editor and the
 * signer both use.
 */
async function locateMarkers(
  pdf: Buffer,
  keys: Set<string>,
): Promise<Map<string, { page: number; x: number; y: number; width: number; height: number }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  // Server-side there is no worker to spawn, and pdf.js otherwise tries to
  // import one from a path that does not exist inside the function bundle.
  // Pointing it at the real module in node_modules makes the fake worker load.
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
  })
  const doc = await task.promise
  const found = new Map<string, { page: number; x: number; y: number; width: number; height: number }>()

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const text = item.str.replace(/[⁣]/g, '')
        const key = [...keys].find((k) => text.includes(k))
        if (!key || found.has(key)) continue

        const [, , , , tx, ty] = item.transform as number[]
        const width = Math.max(item.width ?? 0, 40)
        const height = Math.max(item.height ?? 0, 14)

        found.set(key, {
          page: pageNumber,
          // Bottom-left origin to top-left fractions.
          x: clamp((tx - width) / viewport.width),
          y: clamp((viewport.height - ty - height) / viewport.height),
          width: clamp(width / viewport.width, 0.03),
          height: clamp(height / viewport.height, 0.015),
        })
      }
    }
  } finally {
    await task.destroy()
  }

  return found
}

function clamp(value: number, min = 0): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), 1)
}
