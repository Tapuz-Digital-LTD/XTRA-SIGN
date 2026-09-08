import { mkdirSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import puppeteer, { type Page } from 'puppeteer-core'
import { getDb } from '../../src/server/db'

/**
 * The setup screens on a dev server, at 390 and 1440: the tourism campaign's
 * "הקמת מוצרים באתר" tab, and a company card with its setup card. The tab is
 * skipped, not failed, while the campaign screen does not draw it yet; the
 * company card is always checked. Fails on horizontal overflow.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/setup-tab-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/setup'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTHS = [1440, 390]

async function pick() {
  const db = getDb()
  const org = sql`(select organization_id from users order by created_at limit 1)`
  const groups = await db.execute(sql`
    select g.id, g.name, (select count(*) from follow_up_tasks t where t.group_id = g.id) as tasks
    from groups g
    where g.deleted_at is null and g.organization_id = ${org} and (g.name like '%התיירות%' or g.landing_slug like '%התיירות%')
    order by tasks desc, g.created_at desc limit 1`)
  const companies = await db.execute(sql`
    select c.id, c.name from follow_up_tasks t join companies c on c.id = t.company_id
    where c.deleted_at is null and t.organization_id = ${org}
    order by t.created_at desc limit 1`)
  const group = groups.rows[0] as { id: string; name: string; tasks: string } | undefined
  const company = companies.rows[0] as { id: string; name: string } | undefined
  if (!company) throw new Error('no company with a follow-up task in the dev database')
  return { group, company }
}

/** Anything wider than the viewport makes a phone scroll sideways; that is a failure, not a note. */
async function assertNoOverflow(page: Page, what: string) {
  const { w, sw } = await page.evaluate(() => ({ w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }))
  if (sw > w + 1) throw new Error(`${what}: horizontal overflow (${sw} > ${w})`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const { group, company } = await pick()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    if (!group) console.log('SKIP setup tab: no campaign whose name or slug contains "התיירות"')
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: width < 600 ? 844 : 900 })
      if (group) {
        await page.goto(`${BASE}/projects/${group.id}?tab=setup`, { waitUntil: 'networkidle0', timeout: 90000 })
        if (await page.$('[data-setup-table]')) {
          await assertNoOverflow(page, `setup tab @${width}`)
          await page.screenshot({ path: `${OUT}/setup-tab-${width}.png`, fullPage: width < 600 })
          console.log(`setup tab @${width}: ${OUT}/setup-tab-${width}.png (${group.name}, ${group.tasks} tasks)`)
        } else {
          console.log(`SKIP setup tab @${width}: ?tab=setup shows no table yet (${group.name})`)
        }
      }

      await page.goto(`${BASE}/companies/${company.id}`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.waitForSelector('[data-setup-card]', { timeout: 15000 })
      await assertNoOverflow(page, `company card @${width}`)
      await page.screenshot({ path: `${OUT}/company-${width}.png`, fullPage: width < 600 })
      const card = await page.$('[data-setup-card]')
      await card!.screenshot({ path: `${OUT}/company-setup-card-${width}.png` })
      console.log(`company card @${width}: ${OUT}/company-${width}.png, ${OUT}/company-setup-card-${width}.png (${company.name})`)
    }
    console.log('ok')
  } finally {
    await browser.close()
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
