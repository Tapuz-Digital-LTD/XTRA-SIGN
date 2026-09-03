import puppeteer from 'puppeteer-core'

const OUT = process.env.SHOT_OUT ?? '/private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/ed60198c-01a1-4302-b9d1-599d3b034d1b/scratchpad'
const WIDTHS = [320, 375, 390, 430, 640, 768, 862, 1024, 1440]

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 })
    await page.goto('http://localhost:3057/tourism-2026', { waitUntil: 'networkidle0', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 300))
    await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
    }))
    const hscroll = metrics.scrollWidth > metrics.clientWidth ? ' *** HORIZONTAL SCROLL ***' : ''
    console.log(`w=${w}: scrollWidth=${metrics.scrollWidth} height=${metrics.height}${hscroll}`)
    await page.screenshot({ path: `${OUT}/resp-${w}.png`, fullPage: true })
  }
  await browser.close()
}
main()
