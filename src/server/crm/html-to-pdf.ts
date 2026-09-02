import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer, { type Browser } from 'puppeteer-core'

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
    table { break-inside: avoid; }
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

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const { executablePath, args } = await resolveBrowser()
  const css = await hebrewFontCss()

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath,
      args,
      headless: true,
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
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

    const pdf = await page.pdf({ ...PAGE, printBackground: true, preferCSSPageSize: false })
    return Buffer.from(pdf)
  } finally {
    await browser?.close().catch(() => {})
  }
}
