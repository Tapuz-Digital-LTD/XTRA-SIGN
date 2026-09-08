import puppeteer from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/** The person drawer: no follow-up block for someone who signed and is already a supplier/customer; present otherwise. */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const [g] = await getDb().select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no campaign')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    const check = async (view: string) => {
      await page.goto(`${BASE}/projects/${g.id}?tab=invitations&view=${view}`, { waitUntil: 'networkidle0', timeout: 90000 })
      const row = await page.$('tbody tr')
      if (!row) return null
      await row.evaluate((tr) => (tr as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await new Promise((r) => setTimeout(r, 600))
      const text = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')
      await page.keyboard.press('Escape')
      return { followUp: text.includes('שמירת המעקב'), hasCompany: text.includes('פתח ספק') || text.includes('ספק/לקוח') }
    }
    const signed = await check('signed')
    const invited = await check('invited')
    console.log('signed row:', signed, '| invited row:', invited)
    if (signed && signed.followUp) throw new Error('follow-up block shown for a signed person')
    if (invited && !invited.followUp) throw new Error('follow-up block missing for an invited person')
    console.log('DRAWER FOLLOW-UP OK')
  } finally {
    await browser.close()
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
