import puppeteer from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * Every campaign tab at every width the owner checks, with the intro line
 * and the phone tab picker. Fails on any sideways spill.
 *
 *   SESSION=<token> [PROJECT=<id>] npx dotenv -e .env.local -- npx tsx scripts/qa/campaign-tabs-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/campaign-tabs'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTHS = [375, 390, 430, 768, 1024, 1440]
const TABS = ['overview', 'audience', 'invitations', 'registrations', 'agreements', 'distributions', 'reports', 'settings']

async function projectId(): Promise<string> {
  if (process.env.PROJECT) return process.env.PROJECT
  const [g] = await getDb().select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no self-service campaign in the local DB')
  return g.id
}

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const id = await projectId()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const failures: string[] = []
  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      for (const tab of TABS) {
        await page.goto(`${BASE}/projects/${id}?tab=${tab}`, { waitUntil: 'networkidle0', timeout: 90000 })
        const check = await page.evaluate((expected) => {
          const spill = document.documentElement.scrollWidth > document.documentElement.clientWidth
          const picker = document.querySelector('select') as HTMLSelectElement | null
          const pickerVisible = picker ? getComputedStyle(picker.closest('label') ?? picker).display !== 'none' : false
          const nav = document.querySelector('nav[aria-label="לשוניות הפרויקט"]') as HTMLElement | null
          const navVisible = nav ? getComputedStyle(nav).display !== 'none' : false
          const intro = Array.from(document.querySelectorAll('h2')).some((h) => h.textContent?.trim() === expected)
          return { spill, pickerVisible, navVisible, intro }
        }, { overview: 'סקירה', audience: 'קהל', invitations: 'הזמנות ומעקב', registrations: 'הרשמות', agreements: 'הסכמים', distributions: 'הפצות', reports: 'דוחות', settings: 'הגדרות' }[tab])
        if (check.spill) failures.push(`${tab}@${width} spills sideways`)
        if (width < 768 && !check.pickerVisible) failures.push(`${tab}@${width} no tab picker on phone`)
        if (width >= 768 && !check.navVisible) failures.push(`${tab}@${width} tab row hidden on desktop`)
        if (!check.intro && tab !== 'registrations') failures.push(`${tab}@${width} intro title missing`)
        if (width === 390 || width === 1440) await page.screenshot({ path: `${OUT}/${tab}-${width}.png`, fullPage: false })
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
  console.log(`CAMPAIGN TABS OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
