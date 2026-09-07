import puppeteer from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * The campaign's audience tab, the invite dialog and the person drawer at
 * phone and desktop widths. With CREATE=1 it sends one invitation to a
 * test number through the local (placeholder) provider, so a row exists.
 *
 *   SESSION=<token> [PROJECT=<id>] [CREATE=1] npx dotenv -e .env.local -- npx tsx scripts/qa/audience-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/audience'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function projectId(): Promise<string> {
  if (process.env.PROJECT) return process.env.PROJECT
  const [g] = await getDb()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.goal, 'signing')))
    .orderBy(desc(schema.groups.createdAt))
    .limit(1)
  if (!g) throw new Error('no signing campaign in the local DB')
  return g.id
}

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const id = await projectId()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const failures: string[] = []
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: width < 500 ? 844 : 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/projects/${id}?tab=audience`, { waitUntil: 'networkidle0', timeout: 90000 })
      const spill = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      if (spill) failures.push(`audience tab spills sideways at ${width}`)
      await page.screenshot({ path: `${OUT}/audience-${width}.png`, fullPage: true })

      // The invite dialog.
      const [open] = await page.$$('xpath/.//button[contains(., "שליחת הזמנה")]')
      if (!open) throw new Error('no invite button')
      await open.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await page.screenshot({ path: `${OUT}/invite-${width}.png` })

      if (process.env.CREATE === '1' && width === 1440) {
        await page.type('[role="dialog"] input[maxlength="120"]', 'בדיקה — הזמנה אישית')
        await page.type('[role="dialog"] input[inputmode="tel"]', '0500000123')
        // A campaign for both suppliers and customers asks which one this is.
        const kindRadio = await page.$('[role="dialog"] input[name="inv-kind"]')
        if (kindRadio) await kindRadio.evaluate((el) => (el.parentElement as HTMLElement).click())
        const submit = await page.$('[role="dialog"] form button[type="submit"]')
        if (!submit) throw new Error('no submit button in the dialog')
        await submit.evaluate((b) => (b as HTMLElement).click())
        try {
          await page.waitForFunction(() => document.body.textContent?.includes('ההזמנה נשלחה') || document.body.textContent?.includes('ההזמנה נשמרה'), { timeout: 30000 })
        } catch {
          const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '(no dialog)')
          await page.screenshot({ path: `${OUT}/invite-error-${width}.png` })
          throw new Error(`invite did not complete; dialog says: ${text.slice(0, 400)}`)
        }
        await page.screenshot({ path: `${OUT}/invite-sent-${width}.png` })
        await page.goto(`${BASE}/projects/${id}?tab=audience`, { waitUntil: 'networkidle0', timeout: 90000 })
      } else {
        await page.keyboard.press('Escape')
      }

      // The drawer on the first row, if any.
      const rows = await page.$$(width < 500 ? 'ul li > [role="button"]' : 'tbody tr')
      if (rows.length > 0) {
        await rows[0].evaluate((el) => (el as HTMLElement).click())
        await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => null)
        await new Promise((r) => setTimeout(r, 800))
        await page.screenshot({ path: `${OUT}/drawer-${width}.png` })
        const spill2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        if (spill2) failures.push(`drawer spills sideways at ${width}`)
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
  console.log(`AUDIENCE SHOTS OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
