import puppeteer from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * Campaign → קהל → a supplier's name → the card → "חזרה": back to the same
 * campaign and tab, not to the suppliers list.
 *
 *   SESSION=<token> [PROJECT=<id>] npx dotenv -e .env.local -- npx tsx scripts/qa/audience-back-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function projectId(): Promise<string> {
  if (process.env.PROJECT) return process.env.PROJECT
  const [g] = await getDb().select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no campaign')
  return g.id
}

async function main() {
  const id = await projectId()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    const start = `${BASE}/projects/${id}?tab=audience&q=`
    await page.goto(start, { waitUntil: 'networkidle0', timeout: 90000 })
    const link = await page.$('tbody a[href^="/companies/"]')
    if (!link) throw new Error('no supplier link in the audience table')
    const href = await link.evaluate((a) => a.getAttribute('href') ?? '')
    if (!href.includes('returnTo=')) throw new Error(`supplier link carries no returnTo: ${href}`)
    console.log('link:', decodeURIComponent(href))
    await link.evaluate((a) => (a as HTMLElement).click())
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 30000 }).catch(() => null)
    const label = await page.$eval('[data-back-link]', (a) => a.textContent?.trim() ?? '')
    console.log('back:', decodeURIComponent(await page.$eval('[data-back-link]', (a) => a.getAttribute('href') ?? '')))
    if (!label.includes('קמפיין')) throw new Error(`back link says "${label}", expected חזרה לקמפיין`)
    await page.$eval('[data-back-link]', (a) => (a as HTMLElement).click())
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 30000 }).catch(() => null)
    const url = page.url()
    if (!url.includes(`/projects/${id}`) || !url.includes('tab=audience')) throw new Error(`back landed on ${url}`)
    console.log(`AUDIENCE BACK OK — "${label}" → ${url}`)
  } finally {
    await browser.close()
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
