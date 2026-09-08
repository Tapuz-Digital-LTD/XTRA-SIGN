import puppeteer, { type Page } from 'puppeteer-core'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * The person drawer follows the real work state, not "signed + in the
 * database": invited / registered / signed-with-open-task keep the follow-up
 * block; signed-and-done shows a clean "הושלם" line with "הוסף מעקב" on
 * demand; a future call-back keeps the block; marking a task done never
 * touches the agreement.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/follow-up-states-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/follow-up-states'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const results: string[] = []
let failed = 0
const check = (ok: boolean, label: string, detail?: string) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function drawerByName(page: Page, groupId: string, name: string) {
  // Signed people live in הרשמות; the registration drawer carries the same task panel.
  await page.goto(`${BASE}/projects/${groupId}?tab=joining&view=registrations&q=${encodeURIComponent(name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
  const row = await page.$('tbody tr')
  if (!row) return null
  await row.evaluate((tr) => (tr as HTMLElement).click())
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 700))
  const text = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')
  return text
}

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const db = getDb()
  const [g] = await db.select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no campaign')
  // A signed person with an open task, and one we will mark done for the test.
  const tasks = await db.execute(sql`select t.id, t.status, t.agreement_id, t.lead_id, coalesce(pl.data->>'name', pl.data->>'businessName') as name, a.status as agreement_status, a.completed_at from follow_up_tasks t join project_leads pl on pl.id = t.lead_id join agreements a on a.id = t.agreement_id where t.group_id = ${g.id} and a.status = 'signed' order by t.created_at limit 2`).then((r) => r.rows as { id: string; status: string; agreement_id: string; lead_id: string; name: string; agreement_status: string; completed_at: Date }[])
  if (tasks.length < 2) throw new Error('need two signed people with tasks in the local campaign')
  const [open, toClose] = tasks
  await db.update(schema.followUpTasks).set({ status: 'pending' }).where(eq(schema.followUpTasks.id, open.id))

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    // 1. invited only → follow-up block present.
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=waiting`, { waitUntil: 'networkidle0', timeout: 90000 })
    const invitedRow = await page.$('tbody tr')
    if (invitedRow) {
      await invitedRow.evaluate((tr) => (tr as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await new Promise((r) => setTimeout(r, 600))
      const t = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')
      check(t.includes('שמירת המעקב'), '1. invited: follow-up available')
      await page.keyboard.press('Escape')
    } else check(false, '1. no invited row to check')

    // 2. signed with an OPEN task → task section + follow-up available.
    const openText = await drawerByName(page, g.id, open.name)
    check(Boolean(openText && openText.includes('הקמת מוצר באתר') && openText.includes('שמירת המעקב')), '2. signed + open task: task and follow-up shown', open.name)
    await page.screenshot({ path: `${OUT}/signed-open-task.png` })
    await page.keyboard.press('Escape')

    // 3. mark the other one done via the API used by the UI, then: clean done state, no agreement change.
    const before = await db.select({ status: schema.agreements.status, completedAt: schema.agreements.completedAt }).from(schema.agreements).where(eq(schema.agreements.id, toClose.agreement_id))
    const res = await page.evaluate(async (args) => {
      const r = await fetch(`/api/projects/${args.groupId}/tasks/${args.taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done', link: 'https://example.com/product' }) })
      return r.status
    }, { groupId: g.id, taskId: toClose.id })
    check(res === 200, '3a. task marked done through the API', String(res))
    const after = await db.select({ status: schema.agreements.status, completedAt: schema.agreements.completedAt }).from(schema.agreements).where(eq(schema.agreements.id, toClose.agreement_id))
    check(after[0].status === before[0].status && String(after[0].completedAt) === String(before[0].completedAt), '3b. agreement untouched by the task change')
    const doneText = await drawerByName(page, g.id, toClose.name)
    check(Boolean(doneText && doneText.includes('הושלמו') && !doneText.includes('שמירת המעקב') && doneText.includes('הוסף מעקב')), '3c. signed + done: clean done line, follow-up on demand', `${toClose.name} :: ${(doneText ?? '').replace(/\s+/g, ' ').slice(0, 400)}`)
    await page.screenshot({ path: `${OUT}/signed-done.png` })
    const [reveal] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "הוסף מעקב")]')
    if (reveal) {
      await reveal.evaluate((b) => (b as HTMLElement).click())
      await new Promise((r) => setTimeout(r, 300))
      const revealed = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '')
      check(revealed.includes('שמירת המעקב'), '3d. "הוסף מעקב" reveals the block')
    }
    await page.keyboard.press('Escape')

    // 4. a future call-back keeps the block even when done.
    const lead = { id: toClose.lead_id }
    await db.update(schema.projectLeads).set({ followUpAt: new Date(Date.now() + 3 * 86_400_000) }).where(eq(schema.projectLeads.id, lead.id))
    const futureText = await drawerByName(page, g.id, toClose.name)
    check(Boolean(futureText && futureText.includes('שמירת המעקב')), '4. future call-back date keeps follow-up visible', `tail=${(futureText ?? '(no drawer)').replace(/\s+/g, ' ').slice(-260)} | hasAdd=${(futureText ?? '').includes('הוסף מעקב')}`)
    await page.keyboard.press('Escape')
    // Put the data back as it was.
    await db.update(schema.projectLeads).set({ followUpAt: null }).where(eq(schema.projectLeads.id, lead.id))
    await db.update(schema.followUpTasks).set({ status: toClose.status, link: null, completedAt: null, completedBy: null }).where(eq(schema.followUpTasks.id, toClose.id))
  } finally {
    await browser.close()
  }
  console.log(results.join('\n'))
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`FOLLOW-UP STATES OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  console.log(results.join('\n'))
  process.exit(1)
})
