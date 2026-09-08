import puppeteer, { type Page } from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * The owner's three journeys, as screenshots of the real screens:
 *   1. הזמנה → הרשמה → חתימה   (פניות והצטרפות: ממתינים / הרשמות / כל התהליכים)
 *   2. חתימה → הקמת מוצר באתר   (הקמת מוצרים באתר: "סמן כהוקם")
 *   3. ספקים קיימים → הפצה מרוכזת (ספקים/לקוחות: selection → הפצות: new distribution)
 * Nothing is sent; the mark-done dialog is opened and closed without saving.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/three-flows-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/three-flows'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const failures: string[] = []

async function shot(page: Page, name: string, label: string) {
  const spill = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (spill) failures.push(`${name}: sideways spill`)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${label} → ${name}.png`)
}
const settle = (page: Page, ms = 700) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const [g] = await getDb().select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no campaign')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 860 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    // 0. The campaign's structure.
    await page.goto(`${BASE}/projects/${g.id}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const tabs = await page.$$eval('nav[aria-label="לשוניות הפרויקט"] a', (as) => as.map((a) => a.textContent?.trim()))
    console.log('tabs:', tabs.join(' | '))
    await shot(page, '0-overview', 'סקירה with work cards')

    // 1. הזמנה → הרשמה → חתימה
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=invitations`, { waitUntil: 'networkidle0', timeout: 90000 })
    await shot(page, '1a-joining-invitations', 'פניות והצטרפות · הזמנות ומעקב')
    const [invite] = await page.$$('xpath/.//button[contains(., "שליחת הזמנה")]')
    if (invite) {
      await invite.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await shot(page, '1b-invite-dialog', 'שליחת הזמנה')
      await page.keyboard.press('Escape')
    } else failures.push('no invite button on the joining tab')
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=registrations`, { waitUntil: 'networkidle0', timeout: 90000 })
    await shot(page, '1c-joining-registrations', 'פניות והצטרפות · הרשמות')
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=all`, { waitUntil: 'networkidle0', timeout: 90000 })
    await shot(page, '1d-joining-all', 'פניות והצטרפות · כל התהליכים')
    await page.goto(`${BASE}/projects/${g.id}?tab=agreements&filter=signed`, { waitUntil: 'networkidle0', timeout: 90000 })
    await shot(page, '1e-agreements-signed', 'הסכמים · נחתמו')

    // 2. חתימה → הקמת מוצר באתר
    await page.goto(`${BASE}/projects/${g.id}?tab=setup&status=pending`, { waitUntil: 'networkidle0', timeout: 90000 })
    const setupRows = await page.$$('[data-setup-table] tbody tr')
    await shot(page, '2a-setup-pending', `הקמת מוצרים באתר · ממתינים (${setupRows.length})`)
    const [markDone] = await page.$$('xpath/.//*[@data-setup-table]//button[contains(., "סמן כהוקם")]')
    if (markDone) {
      await markDone.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await page.type('[role="dialog"] input[type="url"], [role="dialog"] input[inputmode="url"], [role="dialog"] input', 'https://www.example.co.il/product/123').catch(() => null)
      await settle(page, 300)
      await shot(page, '2b-mark-done-dialog', 'סמן כהוקם: link + note')
      await page.keyboard.press('Escape')
    } else failures.push('no "סמן כהוקם" on the setup tab')

    // 3. ספקים קיימים → הפצה מרוכזת
    await page.goto(`${BASE}/projects/${g.id}?tab=audience`, { waitUntil: 'networkidle0', timeout: 90000 })
    const boxes = await page.$$('tbody input[type="checkbox"]')
    for (const box of boxes.slice(0, 2)) await box.evaluate((el) => (el as HTMLElement).click())
    await settle(page, 400)
    await shot(page, '3a-audience-selected', 'ספקים/לקוחות · selection + bulk actions')
    await page.goto(`${BASE}/projects/${g.id}?tab=distributions&new=1`, { waitUntil: 'networkidle0', timeout: 90000 })
    await settle(page, 800)
    await shot(page, '3b-distribution-wizard', 'הפצות · new distribution (audience step)')

    // Phone: the picker instead of a clipped tab row.
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=invitations`, { waitUntil: 'networkidle0', timeout: 90000 })
    await shot(page, '4-phone-joining', 'phone · פניות והצטרפות')
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`THREE FLOWS OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
