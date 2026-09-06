import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * The campaigns screen, the three wizard steps and a campaign's overview, at
 * a phone width and on a desktop, with the no-sideways-scroll check.
 *
 *   SESSION=<token> PROJECT=<id> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/campaigns-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const PROJECT = process.env.PROJECT ?? ''
const OUT = process.env.OUT ?? '.design/qa/campaigns'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!SESSION || !PROJECT) throw new Error('SESSION and PROJECT are required')
mkdirSync(OUT, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  const noScroll = async (page: import('puppeteer-core').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  const check = async (page: import('puppeteer-core').Page, label: string) => {
    const ok = await noScroll(page)
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  }
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.screenshot({ path: `${OUT}/list-${width}.png` })
      await check(page, `list ${width}`)
      // the wizard
      const buttons = await page.$$('button')
      for (const b of buttons) if ((await b.evaluate((el) => el.textContent?.trim())) === '+ קמפיין חדש') { await b.click(); break }
      await page.waitForSelector('[role="dialog"]')
      await page.screenshot({ path: `${OUT}/wizard-1-${width}.png` })
      await check(page, `wizard step 1 ${width}`)
      const cards = await page.$$('[role="dialog"] button[aria-pressed]')
      await cards[0].click()
      for (const b of await page.$$('[role="dialog"] button')) if ((await b.evaluate((el) => el.textContent?.trim())) === 'המשך') { await b.click(); break }
      await page.waitForSelector('[role="dialog"] input')
      await page.type('[role="dialog"] input', 'קמפיין QA')
      await page.screenshot({ path: `${OUT}/wizard-2-${width}.png` })
      for (const b of await page.$$('[role="dialog"] button')) if ((await b.evaluate((el) => el.textContent?.trim())) === 'המשך') { await b.click(); break }
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('איך אנשים יצטרפו'))
      await page.screenshot({ path: `${OUT}/wizard-3-${width}.png` })
      await check(page, `wizard step 3 ${width}`)
      // the campaign
      await page.goto(`${BASE}/projects/${PROJECT}`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.screenshot({ path: `${OUT}/overview-${width}.png` })
      await check(page, `overview ${width}`)
      await page.goto(`${BASE}/projects/${PROJECT}?tab=registrations`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.screenshot({ path: `${OUT}/registrations-${width}.png` })
      await check(page, `registrations ${width}`)
      await page.goto(`${BASE}/projects/${PROJECT}?tab=settings`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.screenshot({ path: `${OUT}/settings-${width}.png` })
      await check(page, `settings ${width}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'CAMPAIGNS SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
