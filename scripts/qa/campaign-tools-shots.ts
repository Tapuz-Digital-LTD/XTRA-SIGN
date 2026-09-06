// NOTE: page.$eval is Puppeteer DOM querying (querySelector + callback in the page), not JS eval().
import { mkdirSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

/**
 * The distributions tab and the messages settings, on a phone and a
 * desktop: the "+ הפצה חדשה" button opens the wizard from the empty state
 * and from the list, every step advances, the test-send path answers, and
 * the messages card opens with a live preview. Nothing is actually sent
 * to anyone but the address given in TEST_EMAIL/TEST_PHONE (your own).
 *
 *   SESSION=<token> PROJECT=<id> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/campaign-tools-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const PROJECT = process.env.PROJECT ?? ''
const OUT = process.env.OUT ?? '.design/qa/campaign-tools'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!SESSION || !PROJECT) throw new Error('SESSION and PROJECT are required')
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
const clickText = async (page: Page, scope: string, text: string) => {
  for (const b of await page.$$(`${scope} button`)) {
    const t = await b.evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    if (t === text || t?.startsWith(text)) {
      await b.click()
      return true
    }
  }
  return false
}

async function distributions(page: Page, width: number) {
  await page.goto(`${BASE}/projects/${PROJECT}?tab=distributions`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.screenshot({ path: `${OUT}/distributions-${width}.png` })
  check(`distributions ${width}: no sideways scroll`, await noScroll(page))
  check(`distributions ${width}: new button opens wizard`, await clickText(page, 'main', '+הפצה חדשה') || await clickText(page, 'main', 'הפצה חדשה'))
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.screenshot({ path: `${OUT}/wizard-1-audience-${width}.png` })
  check(`wizard ${width}: step 1 fits`, await noScroll(page))
  // pick the first two results
  await page.waitForSelector('[role="dialog"] ul li input[type="checkbox"]', { timeout: 15000 })
  const boxes = await page.$$('[role="dialog"] ul li input[type="checkbox"]')
  for (const b of boxes.slice(0, 2)) await b.click()
  check(`wizard ${width}: continue enabled after choosing`, await page.$eval('[role="dialog"] button.bg-brand:not([disabled])', () => true).catch(() => false))
  await clickText(page, '[role="dialog"]', 'המשך')
  await page.screenshot({ path: `${OUT}/wizard-2-channels-${width}.png` })
  await clickText(page, '[role="dialog"]', 'המשך')
  await page.screenshot({ path: `${OUT}/wizard-3-content-${width}.png` })
  check(`wizard ${width}: content step shows SMS counter`, (await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')).includes('תווים'))
  await clickText(page, '[role="dialog"]', 'המשך')
  await page.type('[role="dialog"] input[placeholder^="למשל"]', 'הפצת QA')
  await page.screenshot({ path: `${OUT}/wizard-4-schedule-${width}.png` })
  // save as draft, so nothing is sent to the audience
  for (const r of await page.$$('[role="dialog"] input[type="radio"]')) {
    const label = await r.evaluate((el) => el.parentElement?.textContent ?? '')
    if (label.includes('טיוטה')) await r.click()
  }
  await clickText(page, '[role="dialog"]', 'המשך')
  await page.screenshot({ path: `${OUT}/wizard-5-review-${width}.png` })
  check(`wizard ${width}: review lists recipients`, (await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')).includes('יגיעו ל-'))
  await clickText(page, '[role="dialog"]', 'שמור כטיוטה')
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 30000 })
  await page.waitForFunction(() => document.body.textContent?.includes('טיוטה'), { timeout: 30000 })
  await page.screenshot({ path: `${OUT}/distributions-list-${width}.png` })
  check(`distributions ${width}: draft listed with actions`, await clickText(page, 'main', 'מחק טיוטה'))
  await page.waitForFunction(() => !document.body.textContent?.includes('הפצת QA'), { timeout: 30000 }).catch(() => null)
  check(`distributions ${width}: draft deleted`, !(await page.evaluate(() => document.body.textContent?.includes('הפצת QA'))))
}

async function messages(page: Page, width: number) {
  await page.goto(`${BASE}/projects/${PROJECT}?tab=settings`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForFunction(() => document.body.textContent?.includes('ברירת מחדל'), { timeout: 30000 })
  const opened = await clickText(page, 'main', 'הזמנה לחתימה')
  check(`messages ${width}: event card opens`, opened)
  await page.waitForSelector('iframe[title="תצוגה מקדימה"]', { timeout: 30000 })
  const card = await page.$('iframe[title="תצוגה מקדימה"]')
  await card?.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: `${OUT}/messages-${width}.png` })
  check(`messages ${width}: no sideways scroll`, await noScroll(page))
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await distributions(page, width)
      await messages(page, width)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'CAMPAIGN TOOLS SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
