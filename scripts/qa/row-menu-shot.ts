import puppeteer from 'puppeteer-core'

/**
 * Opens the ⋯ menu on the agreements table and checks that its items are
 * fully visible (not covered by the sticky actions cells of the rows below).
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/row-menu-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '/tmp/row-menu.png'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    await page.goto(`${BASE}/documents`, { waitUntil: 'networkidle0', timeout: 90000 })
    const buttons = await page.$$('button[aria-label="פעולות"]')
    if (buttons.length < 2) throw new Error(`expected rows with actions, found ${buttons.length}`)
    await buttons[1].evaluate((b) => (b as HTMLElement).scrollIntoView({ block: 'center' }))
    await buttons[1].evaluate((b) => (b as HTMLElement).click())
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
    const result = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]') as HTMLElement
      const rect = menu.getBoundingClientRect()
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
      const covered = items.filter((item) => {
        const r = item.getBoundingClientRect()
        const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !(probe === item || item.contains(probe))
      })
      return { rect: { left: rect.left, right: rect.right, top: rect.top }, items: items.map((i) => i.textContent), covered: covered.map((i) => i.textContent) }
    })
    await page.screenshot({ path: OUT })
    console.log(JSON.stringify(result))
    if (result.covered.length) throw new Error(`menu items covered: ${result.covered.join(', ')}`)
    console.log('menu ok')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
