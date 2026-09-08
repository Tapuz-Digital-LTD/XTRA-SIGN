import puppeteer from 'puppeteer-core'

/** The header at desktop widths: every nav label on one line, nothing overflowing. */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/header'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const failures: string[] = []
  try {
    for (const width of [1024, 1280, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 400 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/suppliers`, { waitUntil: 'networkidle0', timeout: 90000 })
      const check = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('nav[aria-label="ניווט ראשי"] a')) as HTMLElement[]
        const tall = links.filter((a) => a.getBoundingClientRect().height > 48).map((a) => a.textContent?.trim())
        const spill = document.documentElement.scrollWidth > document.documentElement.clientWidth
        const main = document.querySelector('main') as HTMLElement | null
        return { tall, spill, mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0 }
      })
      if (check.tall.length) failures.push(`${width}: wrapped labels ${check.tall.join(', ')}`)
      if (check.spill) failures.push(`${width}: sideways spill`)
      console.log(`${width}: main ${check.mainWidth}px`)
      await page.screenshot({ path: `${OUT}/header-${width}.png` })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`HEADER OK → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
