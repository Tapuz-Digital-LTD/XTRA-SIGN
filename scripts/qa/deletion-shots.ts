import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * The deletion conversation on screen: open the suppliers list, open a
 * row's menu, ask to delete, and photograph what the dialog says — at a
 * phone width and on a desktop. Checks the page never scrolls sideways.
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/deletion-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/deletion'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!SESSION) throw new Error('SESSION required')
mkdirSync(OUT, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      // A supplier with signed history: the protected path.
      await page.goto(`${BASE}/suppliers?q=E2E`, { waitUntil: 'networkidle0', timeout: 90000 })
      const menus = await page.$$('button[aria-label="פעולות נוספות"]')
      const visible = []
      for (const m of menus) if (await m.isIntersectingViewport()) visible.push(m)
      if (visible.length === 0) throw new Error('no row menu visible')
      await visible[0].click()
      await page.waitForSelector('[role="menu"]')
      await page.screenshot({ path: `${OUT}/menu-${width}.png` })
      const items = await page.$$('[role="menuitem"]')
      const labels = await Promise.all(items.map((i) => i.evaluate((el) => el.textContent?.trim())))
      console.log(`${width}px menu: ${labels.join(' | ')}`)
      const del = items[labels.indexOf('מחיקה')]
      await del.click()
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('היסטוריה'), { timeout: 15000 })
      // page.$eval is Puppeteer's DOM query on a fixed selector, not JavaScript eval.
      const text = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')
      const ok = text.includes('לא ניתן למחוק את הרשומה במחיקה רגילה') || text.includes('נדרש אישור מנהל')
      const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }))
      const noScroll = scroll.sw <= scroll.vw + 1
      if (!ok || !noScroll) failures++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${width}px protected dialog  ${noScroll ? '' : `HORIZONTAL SCROLL ${scroll.sw}>${scroll.vw}`}`)
      await page.screenshot({ path: `${OUT}/dialog-protected-${width}.png` })
      // The admin's second step.
      const buttons = await page.$$('[role="dialog"] button')
      for (const b of buttons) {
        const t = await b.evaluate((el) => el.textContent?.trim())
        if (t === 'מחיקה מוגנת') {
          await b.click()
          break
        }
      }
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('אני מבין'), { timeout: 5000 }).catch(() => {})
      await page.screenshot({ path: `${OUT}/dialog-protected-step2-${width}.png` })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'DELETION SHOTS OK' : `${failures} failures`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
