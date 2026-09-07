import puppeteer from 'puppeteer-core'

/**
 * The home page's "שלח מסמך לחתימה" dialog, step by step, and the tracking
 * screen — at phone and desktop widths. With CREATE=1 one document goes to
 * a test number through the local (placeholder) provider.
 *
 *   SESSION=<token> [CREATE=1] npx tsx scripts/qa/quick-send-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/quick-send'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const failures: string[] = []
  const spill = async (page: import('puppeteer-core').Page, label: string) => {
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) failures.push(`${label} spills sideways`)
  }
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: width < 500 ? 844 : 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 90000 })
      await spill(page, `home ${width}`)
      const [open] = await page.$$('xpath/.//button[contains(., "שלח מסמך לחתימה")]')
      if (!open) throw new Error('no quick-send button on the home page')
      await open.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await page.screenshot({ path: `${OUT}/step1-existing-${width}.png` })

      // New recipient.
      const [newMode] = await page.$$('xpath/.//div[@role="dialog"]//label[contains(., "נמען חדש")]')
      await newMode.evaluate((el) => (el as HTMLElement).click())
      await page.type('[role="dialog"] input[maxlength="120"]', 'בדיקה — נמען חדש')
      await page.type('[role="dialog"] input[inputmode="tel"]', '0500000123')
      await page.screenshot({ path: `${OUT}/step1-new-${width}.png` })
      const [next1] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "המשך")]')
      await next1.evaluate((b) => (b as HTMLElement).click())
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('שולחים אל'), { timeout: 5000 })
      await page.screenshot({ path: `${OUT}/step2-${width}.png` })
      const firstTemplate = await page.$('[role="dialog"] input[name="qs-template"]')
      if (!firstTemplate) throw new Error('no template to choose (create one with a signature field first)')
      await firstTemplate.evaluate((el) => (el.parentElement as HTMLElement).click())
      const [next2] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "המשך")]')
      await next2.evaluate((b) => (b as HTMLElement).click())
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('כך זה ייראה'), { timeout: 5000 })
      await page.screenshot({ path: `${OUT}/step3-${width}.png` })
      await spill(page, `dialog ${width}`)

      if (process.env.CREATE === '1' && width === 1440) {
        const [send] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "שליחה")]')
        await send.evaluate((b) => (b as HTMLElement).click())
        try {
          await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('המסמך נשלח'), { timeout: 60000 })
        } catch {
          const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '(no dialog)')
          await page.screenshot({ path: `${OUT}/send-error-${width}.png` })
          throw new Error(`quick send did not complete; dialog says: ${text.slice(0, 300)}`)
        }
        await page.screenshot({ path: `${OUT}/done-${width}.png` })
      }
      await page.keyboard.press('Escape')

      await page.goto(`${BASE}/tracking`, { waitUntil: 'networkidle0', timeout: 90000 })
      await spill(page, `tracking ${width}`)
      await page.screenshot({ path: `${OUT}/tracking-${width}.png`, fullPage: true })
      const rows = await page.$$(width < 500 ? 'ul li > [role="button"]' : 'tbody tr')
      if (rows.length > 0) {
        await rows[0].evaluate((el) => (el as HTMLElement).click())
        await new Promise((r) => setTimeout(r, 900))
        await page.screenshot({ path: `${OUT}/tracking-drawer-${width}.png` })
        await spill(page, `tracking drawer ${width}`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`QUICK SEND SHOTS OK → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
