import puppeteer from 'puppeteer-core'

/**
 * Full-page screenshots of a campaign page at every width that matters,
 * with a horizontal-scroll check.
 *
 *   SHOT_PATH=/tourism-2026/join npx tsx scripts/design/shots-responsive.ts
 */

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3057'
const PATH = process.env.SHOT_PATH ?? '/tourism-2026'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'
const WIDTHS = (process.env.SHOT_WIDTHS ?? '320,375,390,430,768,1024,1440,1920').split(',').map(Number)
const SLUG = PATH.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${BASE}${PATH}`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    await new Promise((r) => setTimeout(r, 300))
    await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
    }))
    const hscroll = metrics.scrollWidth > metrics.clientWidth ? '  *** HORIZONTAL SCROLL ***' : ''
    console.log(`w=${width}: scrollWidth=${metrics.scrollWidth} height=${metrics.height}${hscroll}`)
    await page.screenshot({ path: `${OUT}/resp-${SLUG}-${width}.png`, fullPage: true })
  }
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
