import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * Suppliers, one source at a time: the XTRA Sign list, the CRM list, the
 * "where to create" chooser, the form after choosing XTRA Sign, and the
 * reports on "כל המקורות" — at a phone width and on a desktop, with the
 * no-sideways-scroll check.
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/companies-source-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/companies-source'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!SESSION) throw new Error('SESSION is required')
mkdirSync(OUT, { recursive: true })

type Page = import('puppeteer-core').Page

async function clickButton(page: Page, text: string) {
  for (const b of await page.$$('button')) {
    if ((await b.evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim()))?.includes(text)) {
      await b.click()
      return
    }
  }
  throw new Error(`no button "${text}"`)
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  const noScroll = async (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  const check = async (page: Page, label: string) => {
    const ok = await noScroll(page)
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  }
  const shot = async (page: Page, url: string, name: string, width: number) => {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.screenshot({ path: `${OUT}/${name}-${width}.png` })
    await check(page, `${name} ${width}`)
  }
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

      await shot(page, '/suppliers', 'suppliers-xtra', width)
      await shot(page, '/suppliers?source=crm', 'suppliers-crm', width)

      // The chooser, then the form after picking XTRA Sign. Nothing is submitted.
      await page.goto(`${BASE}/suppliers`, { waitUntil: 'networkidle0', timeout: 90000 })
      await clickButton(page, 'הוספת ספק')
      await page.waitForFunction(() => document.body.textContent?.includes('היכן ליצור'))
      await page.screenshot({ path: `${OUT}/create-chooser-${width}.png` })
      await check(page, `create chooser ${width}`)
      await clickButton(page, 'XTRA Sign')
      await page.waitForSelector('form')
      await page.screenshot({ path: `${OUT}/create-form-xtra-${width}.png` })
      await check(page, `create form xtra ${width}`)

      await shot(page, '/suppliers/reports?source=all', 'reports-all', width)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'COMPANIES SOURCE SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
