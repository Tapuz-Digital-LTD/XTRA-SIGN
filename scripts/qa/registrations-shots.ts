import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * The registrations table on the report, its drawer and its row menu, at a
 * phone width and on a desktop — with the no-sideways-scroll check.
 *
 *   SESSION=<token> PROJECT=<id> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/registrations-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const PROJECT = process.env.PROJECT ?? ''
const OUT = process.env.OUT ?? '.design/qa/registrations'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!SESSION || !PROJECT) throw new Error('SESSION and PROJECT are required')
mkdirSync(OUT, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/projects/${PROJECT}?tab=reports&range=30d`, { waitUntil: 'networkidle0', timeout: 90000 })
      const section = await page.$('[aria-labelledby="rp-registrations"]')
      if (!section) throw new Error('registrations section missing')
      await section.evaluate((el) => el.scrollIntoView())
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
      await page.screenshot({ path: `${OUT}/table-${width}.png` })
      // the row menu
      // Both the cards and the table are in the DOM; only one is shown at this width.
      let menu = null
      for (const m of await page.$$('[aria-labelledby="rp-registrations"] button[aria-label="פעולות נוספות"]')) {
        if (await m.isIntersectingViewport()) { menu = m; break }
      }
      if (!menu) throw new Error('no visible row menu')
      await menu.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      await menu.click()
      await page.waitForSelector('[role="menu"]')
      // page.$$eval is Puppeteer's DOM query on a fixed selector, not JavaScript eval.
      const items = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent?.trim()))
      await page.screenshot({ path: `${OUT}/menu-${width}.png` })
      await page.keyboard.press('Escape')
      // the drawer
      const row = width < 768 ? (await page.$$('[aria-labelledby="rp-registrations"] li button'))[0] : (await page.$$('[aria-labelledby="rp-registrations"] tbody tr td:nth-child(2)'))[0]
      const rowEl = row as import('puppeteer-core').ElementHandle<Element>
      await rowEl.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }))
      await rowEl.click()
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('פעילות'), { timeout: 15000 })
      const drawerNoScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
      await page.screenshot({ path: `${OUT}/drawer-${width}.png` })
      const ok = noScroll && drawerNoScroll
      if (!ok) failures++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${width}px  menu: ${items.join(' | ')}${noScroll ? '' : '  TABLE SCROLLS'}${drawerNoScroll ? '' : '  DRAWER SCROLLS'}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'REGISTRATIONS SHOTS OK' : `${failures} widths failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
