import { mkdirSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

/**
 * Walks the report builder at phone and desktop widths and keeps a screenshot
 * of each step: the tracking tab, the builder with two conditions (one an
 * "או" group), the columns dialog, the results after "הצג דוח" (or the error
 * state, shown gracefully), the export dialog and the save dialog. Fails on
 * horizontal overflow and when "הצג דוח" does not POST the definition built.
 *
 *   SESSION=$(npx dotenv -e .env.local -- npx tsx scripts/dev-session.ts) E2E_BASE=http://localhost:3057 OUT=/tmp/report-builder npx tsx scripts/qa/report-builder-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '/tmp/report-builder'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function shot(page: Page, name: string) {
  await wait(300)
  const overflow = await page.evaluate(() => ({ w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, tall: document.documentElement.scrollHeight > window.innerHeight }))
  // fullPage on a page shorter than the viewport shifts an RTL document sideways in the capture; plain shot then.
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: overflow.tall })
  if (overflow.sw > overflow.w + 1) throw new Error(`${name}: horizontal overflow (${overflow.sw} > ${overflow.w})`)
  console.log(`  ${name}.png ok`)
}

async function clickButton(page: Page, text: string) {
  const clicked = await page.evaluate((t) => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith(t))
    if (!button) return false
    button.click()
    return true
  }, text)
  if (!clicked) throw new Error(`no button "${text}"`)
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 5000 })
}

async function run(page: Page, width: number) {
  console.log(`— ${width}px`)
  await page.setViewport({ width, height: width < 768 ? 844 : 900 })

  // 1. Tracking tab, then one preset card into the results area.
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('[role="tab"]')
  await shot(page, `tracking-${width}`)
  await clickButton(page, 'הוזמנו ולא נרשמו')
  await page.waitForSelector('[data-testid="results-count"], [role="alert"]', { timeout: 30000 })
  if (!page.url().includes('preset=invited_not_registered')) throw new Error(`preset not in URL: ${page.url()}`)
  await shot(page, `tracking-results-${width}`)
  // A row into the drawer, a row into the selection, and the reminder preview over it.
  const rowButton = await page.$(width < 768 ? 'li button.min-w-0' : 'tbody tr')
  if (rowButton) {
    await rowButton.evaluate((el) => (el as HTMLElement).click())
    await page.waitForSelector('[role="dialog"]')
    await shot(page, `drawer-${width}`)
    await closeDialog(page)
    const box = await page.$('tbody input[type="checkbox"], li input[type="checkbox"]')
    await box!.evaluate((el) => (el as HTMLElement).click())
    await page.waitForSelector('[data-testid="bulk-bar"]')
    await shot(page, `tracking-selected-${width}`)
    await clickButton(page, 'תזכורת')
    await page.waitForSelector('[role="dialog"]')
    await page.waitForFunction(() => /יבוצע על|ידולגו|נכשל/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), { timeout: 30000 })
    await shot(page, `bulk-remind-${width}`)
    await closeDialog(page)
    await clickButton(page, 'ביטול בחירה')
  } else console.log('  no rows in the preset: drawer/bulk skipped')

  // 2. Builder: suppliers, name contains "א" OR contact_name contains "ב", AND signature_status is signed.
  await page.goto(`${BASE}/reports?tab=builder`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('[data-testid="run-report"]:not([disabled])', { timeout: 30000 })
  await clickButton(page, '+ הוספת תנאי')
  await page.waitForSelector('select[aria-label="שדה"]')
  await (await page.$$('select[aria-label="שדה"]'))[0].select('name')
  await page.waitForSelector('input[aria-label="ערך"]')
  await (await page.$$('input[aria-label="ערך"]'))[0].type('א')
  await clickButton(page, '+ או')
  await wait(100)
  await (await page.$$('select[aria-label="שדה"]'))[1].select('contact_name')
  await wait(100)
  await (await page.$$('input[aria-label="ערך"]'))[1].type('ב')
  await clickButton(page, '+ הוספת תנאי')
  await wait(100)
  await (await page.$$('select[aria-label="שדה"]'))[2].select('signature_status')
  await wait(100)
  await (await page.$$('select[aria-label="ערך"]'))[0].select('signed')
  await wait(200)
  await shot(page, `builder-conditions-${width}`)

  // 3. Columns dialog.
  await clickButton(page, 'עמודות (')
  await page.waitForSelector('[role="dialog"]')
  await shot(page, `columns-${width}`)
  await closeDialog(page)

  // 4. Run: the POST must carry what was built; the screen shows rows or a graceful error.
  const bodies: string[] = []
  const onRequest = (request: { url(): string; method(): string; postData(): string | undefined }) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/reports/run')) bodies.push(request.postData() ?? '')
  }
  page.on('request', onRequest)
  await clickButton(page, 'הצג דוח')
  await page.waitForSelector('[data-testid="results-count"], [role="alert"]', { timeout: 30000 })
  page.off('request', onRequest)
  const body = JSON.parse(bodies[bodies.length - 1] ?? '{}')
  if (body.entity !== 'suppliers' || body.clauses?.length !== 2 || body.clauses[0].any.length !== 2 || body.clauses[0].any[0].op !== 'contains' || body.clauses[1].any[0].value !== 'signed' || body.pageSize !== 25) throw new Error(`run body: ${bodies[bodies.length - 1]}`)
  console.log(`  run body ok: ${bodies[bodies.length - 1]}`)
  // The URL now carries the definition; back drops it, forward brings it back — with the results.
  const encoded = new URL(page.url()).searchParams.get('d')
  if (!encoded) throw new Error('definition not written to ?d=')
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (decoded.entity !== 'suppliers' || decoded.clauses.length !== 2 || decoded.clauses[0].any.length !== 2) throw new Error(`unexpected ?d=: ${JSON.stringify(decoded)}`)
  await page.goBack()
  await page.waitForSelector('[data-testid="results-count"], [role="alert"]', { hidden: true, timeout: 10000 })
  await page.goForward()
  await page.waitForSelector('[data-testid="results-count"], [role="alert"]', { timeout: 30000 })
  console.log('  back/forward ok')
  const failed = await page.$('[role="alert"]')
  if (failed) console.log(`  run answered with an error (shown in place): ${await failed.evaluate((el) => el.textContent?.trim())}`)
  // Select the first row when there is one, so the bulk bar is in the picture.
  const firstRow = await page.$('tbody input[type="checkbox"], li input[type="checkbox"]')
  if (firstRow) {
    await firstRow.evaluate((el) => (el as HTMLElement).click())
    await page.waitForSelector('[data-testid="bulk-bar"]')
  }
  await shot(page, `results-${width}`)

  // 5. Export and save dialogs.
  const canOpen = await page.evaluate(() => !!(document.querySelector('[data-testid="results-count"]')))
  if (canOpen) {
    await clickButton(page, 'ייצוא לאקסל')
    await page.waitForSelector('[role="dialog"]')
    await shot(page, `export-${width}`)
    await closeDialog(page)
    await clickButton(page, 'שמור דוח')
    await page.waitForSelector('[role="dialog"]')
    await shot(page, `save-${width}`)
    await closeDialog(page)
  } else console.log('  export/save skipped: no results to act on')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    page.on('pageerror', (e) => console.log(`  page error: ${e instanceof Error ? e.message : String(e)}`))
    for (const width of [390, 1440]) await run(page, width)
    console.log('all ok')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
