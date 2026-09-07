import puppeteer from 'puppeteer-core'

/**
 * The ⋯ menu on the LAST row of the campaigns, suppliers and registrations
 * lists must be fully visible without scrolling the table — it is rendered
 * at the body, above everything, flipping upward near the bottom edge.
 *
 *   SESSION=<token> npx tsx scripts/qa/list-menus-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/list-menus'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const failures: string[] = []
  try {
    for (const path of ['/projects', '/suppliers?source=xtra']) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 620 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90000 })
      const buttons = await page.$$('button[aria-label="פעולות נוספות"]')
      if (buttons.length === 0) {
        failures.push(`${path}: no row menus`)
        await page.close()
        continue
      }
      const last = buttons[buttons.length - 1]
      await last.evaluate((b) => (b as HTMLElement).scrollIntoView({ block: 'end' }))
      await last.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('[role="menu"]', { timeout: 5000 })
      const result = await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"]') as HTMLElement
        const r = menu.getBoundingClientRect()
        const inViewport = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
        const covered = items.filter((item) => {
          const b = item.getBoundingClientRect()
          const probe = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          return !(probe === item || item.contains(probe))
        })
        return { inViewport, covered: covered.map((c) => c.textContent), rect: { top: r.top, bottom: r.bottom }, vh: window.innerHeight }
      })
      await page.screenshot({ path: `${OUT}/${path.replace(/[^a-z]+/g, '-')}.png` })
      if (!result.inViewport) failures.push(`${path}: menu outside the viewport ${JSON.stringify(result.rect)} vh=${result.vh}`)
      if (result.covered.length) failures.push(`${path}: covered items ${result.covered.join(', ')}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`LIST MENUS OK → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
