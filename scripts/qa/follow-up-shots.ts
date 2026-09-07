import { sql } from 'drizzle-orm'
import puppeteer, { type Page } from 'puppeteer-core'
import { getDb } from '../../src/server/db'

/**
 * Follow-up tasks, end to end on a dev server: switches the task on for the
 * campaign with the most signatures, backfills, and screenshots the
 * settings card and the registrations table (filtered to "חתמו וטרם
 * הוקמו") at 390 and 1440. Then presses "✓ הוקם" on one row and checks the
 * chip changed, and puts that task back to pending.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/follow-up-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/follow-up'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function pickGroup(): Promise<string> {
  if (process.env.GROUP_ID) return process.env.GROUP_ID
  const result = await getDb().execute(sql`
    select g.id, g.name, count(*) filter (where a.status = 'signed') as signed
    from groups g
    join project_leads pl on pl.group_id = g.id
    left join agreements a on a.id = pl.agreement_id
    where g.deleted_at is null and g.organization_id = (select organization_id from users order by created_at limit 1)
    group by g.id order by signed desc limit 1`)
  const row = result.rows[0] as { id: string; name: string; signed: string } | undefined
  if (!row) throw new Error('no campaign with registrations')
  console.log(`campaign: ${row.name} (${row.id}) signed=${row.signed}`)
  return row.id
}

async function api(page: Page, path: string, init: { method: string; body?: unknown }) {
  return page.evaluate(
    async ({ path, init }) => {
      const r = await fetch(path, { method: init.method, headers: { 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
      return { status: r.status, data: await r.json().catch(() => null) }
    },
    { path, init },
  )
}

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const groupId = await pickGroup()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${BASE}/projects/${groupId}?tab=settings&section=advanced`, { waitUntil: 'networkidle0', timeout: 90000 })

    // Switch the task on and create it for everyone who already signed.
    console.log('config', JSON.stringify(await api(page, `/api/projects/${groupId}/campaign`, { method: 'PUT', body: { followUpConfig: { afterSign: ['site_product'] } } })))
    console.log('dry-run', JSON.stringify(await api(page, `/api/projects/${groupId}/tasks/backfill`, { method: 'POST', body: { apply: false } })))
    console.log('apply', JSON.stringify(await api(page, `/api/projects/${groupId}/tasks/backfill`, { method: 'POST', body: { apply: true } })))
    console.log('tasks', JSON.stringify((await api(page, `/api/projects/${groupId}/tasks?status=pending`, { method: 'GET' })).data?.counts))

    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width < 600 ? 844 : 900 })
      await page.goto(`${BASE}/projects/${groupId}?tab=settings&section=advanced`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.waitForSelector('#fu-title', { timeout: 15000 })
      const card = await page.$('section[aria-labelledby="fu-title"]')
      await card!.screenshot({ path: `${OUT}/settings-card-${width}.png` })
      await page.screenshot({ path: `${OUT}/settings-${width}.png`, fullPage: width < 600 })

      await page.goto(`${BASE}/projects/${groupId}?tab=registrations&taskFilter=pending`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.waitForSelector('a[aria-pressed="true"]', { timeout: 15000 })
      await page.screenshot({ path: `${OUT}/registrations-pending-${width}.png`, fullPage: width < 600 })
    }

    // One click on "✓ הוקם": the chip changes, the row leaves the pending filter after refresh.
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${BASE}/projects/${groupId}?tab=registrations&taskFilter=pending`, { waitUntil: 'networkidle0', timeout: 90000 })
    const before = await page.$$eval('tbody button[aria-label="סמן שהמוצר הוקם באתר"]', (b) => b.length)
    const first = await page.$('tbody button[aria-label="סמן שהמוצר הוקם באתר"]')
    if (!first) throw new Error('no pending task button on screen')
    const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/tasks/'), { timeout: 15000 })
    await first.click()
    console.log('patch status', (await patched).status())
    await page.waitForFunction((n: number) => document.querySelectorAll('tbody button[aria-label="סמן שהמוצר הוקם באתר"]').length < n, { timeout: 15000 }, before)
    await page.screenshot({ path: `${OUT}/after-mark-done-1440.png` })
    const done = (await api(page, `/api/projects/${groupId}/tasks?status=done`, { method: 'GET' })).data as { tasks: { id: string; status: string }[] }
    console.log('done now', done.tasks.length)
    // Put it back, so the local data stays as it was apart from the tasks themselves.
    if (done.tasks[0]) console.log('reset', JSON.stringify((await api(page, `/api/projects/${groupId}/tasks/${done.tasks[0].id}`, { method: 'PATCH', body: { status: 'pending' } })).status))
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
