import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { log } from '@/server/log'

/**
 * Turning a Fireberry template's HTML into a PDF.
 *
 * This runs exactly once per imported template, and that is the whole design.
 * The PDF it returns is stored and becomes the immutable artefact that signature
 * fields are placed on; it is never regenerated. So a later Chromium upgrade
 * cannot move a field by half a millimetre, and the question of whether two
 * Chromium versions lay text out identically never has to be answered.
 *
 * The template is third-party content, so the page it renders in is inert:
 * scripting is off and every network request is refused. Images were already
 * embedded as data URIs by `inlineAssets`, so nothing legitimate needs fetching
 * — which means blocking everything costs nothing and removes SSRF-at-render
 * entirely.
 *
 * The Hebrew problem: @sparticuz/chromium ships Open Sans, which covers Latin,
 * Greek and Cyrillic and no Hebrew at all. Left alone, every Hebrew character
 * renders as a box — on a PDF that is otherwise perfectly well-formed. The fix
 * is to embed the font the signed PDFs already use and to alias it onto the
 * families these templates actually ask for.
 */

const FONT_PATH = join(process.cwd(), 'src/server/signing/assets/Assistant-Regular.ttf')

/** A4 with a margin that matches what the CRM's own print view uses. */
const PAGE = { format: 'a4' as const, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } }

/** Where a developer's browser lives, per platform. Production never uses these. */
const LOCAL_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

let fontCss: string | null = null

/**
 * `@font-face` rules that put a Hebrew font behind the family names the
 * templates request.
 *
 * Aliasing rather than overriding: the templates ask for Arial/Helvetica, so
 * declaring those names is what makes the cascade resolve to a font that has
 * the glyphs, without an `!important` sledgehammer that would also flatten any
 * deliberate typography. The font travels inside the document as a data URI, so
 * there is no font path, no OS font config and no network involved.
 */
async function hebrewFontCss(): Promise<string> {
  if (fontCss) return fontCss
  const base64 = (await readFile(FONT_PATH)).toString('base64')
  const src = `url(data:font/ttf;base64,${base64}) format('truetype')`
  fontCss = `
    @font-face { font-family: 'Assistant'; src: ${src}; font-weight: 100 900; font-display: block; }
    @font-face { font-family: 'Arial'; src: ${src}; font-weight: 100 900; font-display: block; }
    @font-face { font-family: 'Helvetica'; src: ${src}; font-weight: 100 900; font-display: block; }
    @font-face { font-family: 'Times New Roman'; src: ${src}; font-weight: 100 900; font-display: block; }
    html, body { font-family: 'Assistant', sans-serif; }
    /* A page break inside a table row or a heading reads as a printing fault. */
    tr, td, th, h1, h2, h3, h4, h5, h6, li { break-inside: avoid; }
    /* Nothing may animate: an animation mid-capture is a non-deterministic render. */
    *, *::before, *::after { animation: none !important; transition: none !important; }
  `
  return fontCss
}

/** The serverless binary on Vercel; a developer's own browser everywhere else. */
async function resolveBrowser(): Promise<{ executablePath: string; args: string[] }> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
    return { executablePath: await chromium.executablePath(), args: chromium.args }
  }
  const local = LOCAL_BROWSERS.find((path) => existsSync(path))
  if (!local) {
    throw new Error(
      'No local Chrome or Chromium found for rendering. Install Google Chrome, or run this on Vercel where the bundled binary is used.',
    )
  }
  return { executablePath: local, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
}

/** The printable width of an A4 page at the margins above, in CSS pixels. */
const PRINTABLE_WIDTH_PX = Math.round(((210 - 24) / 25.4) * 96)

/**
 * How much to shrink the document so it prints the way it was designed.
 *
 * A CRM print template is drawn on a canvas of the author's choosing, and the
 * engine that prints it fits that canvas onto the paper. Rendering it at 1:1
 * instead does not just change the margins: text set for a 1000px canvas wraps
 * far more often inside a 703px page, and an agreement that its author sees as
 * two pages arrives as six.
 *
 * The design width is measured from the widest block the template actually
 * lays out, so a template already drawn at page width scales by 1 and is left
 * exactly as it was.
 */
async function fitToPage(page: Page): Promise<number> {
  const designWidth = await page.evaluate(() => {
    // Overflow past the page is what reveals the canvas the template was drawn
    // on; content that fits reports exactly the page width.
    const doc = document.documentElement
    return Math.max(doc.scrollWidth, document.body.scrollWidth)
  })

  // Chromium refuses anything outside 0.1–2, and shrinking past 60% turns a
  // readable agreement into something nobody can sign in good conscience.
  const raw = designWidth > PRINTABLE_WIDTH_PX ? PRINTABLE_WIDTH_PX / designWidth : 1
  const scale = Math.min(1, Math.max(0.6, raw))

  log.info('crm pdf fit', { designWidth, printableWidth: PRINTABLE_WIDTH_PX, scale })
  return scale
}

export type RenderOptions = {
  /**
   * Whether to shrink a document drawn on a canvas wider than the page.
   *
   * On for CRM templates, which are drawn to someone else's canvas. Off for a
   * document we laid out ourselves in page millimetres — scaling that would
   * move every element away from where its author put it, which is exactly the
   * promise the canvas editor makes.
   */
  fitToPage?: boolean
  /** Overrides the page margins; the canvas supplies its own. */
  margin?: string
}

export async function renderHtmlToPdf(
  html: string,
  options: RenderOptions = {},
): Promise<Buffer> {
  const { executablePath, args } = await resolveBrowser()
  const css = await hebrewFontCss()

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath,
      args,
      headless: true,
      // The printable width, so the page lays out at the size it will print
      // at and `fitToPage` measures real overflow rather than the viewport.
      defaultViewport: { width: PRINTABLE_WIDTH_PX, height: 1123, deviceScaleFactor: 1 },
    })
    const page = await browser.newPage()

    // Inert page: the template cannot run code and cannot reach anything.
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      // Only the document we hand over ourselves is allowed to load.
      if (request.url().startsWith('data:') || request.isNavigationRequest()) request.continue().catch(() => {})
      else request.abort().catch(() => {})
    })

    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`, {
      waitUntil: 'load',
      timeout: 30_000,
    })
    await page.emulateMediaType('print')
    // An embedded font is decoded asynchronously; capturing before it is ready
    // is exactly how a correct-looking PDF ends up full of fallback glyphs.
    await page.evaluate(() => document.fonts.ready)

    const scale = options.fitToPage === false ? 1 : await fitToPage(page)
    const margin = options.margin
      ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin }
      : PAGE.margin
    const pdf = await page.pdf({
      ...PAGE,
      margin,
      scale,
      printBackground: true,
      // The canvas sets its own @page size in millimetres, and honouring it is
      // what keeps a stored coordinate and a printed one the same number.
      preferCSSPageSize: options.fitToPage === false,
    })
    return Buffer.from(pdf)
  } finally {
    await browser?.close().catch(() => {})
  }
}
