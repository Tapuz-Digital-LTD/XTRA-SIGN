import { mkdirSync } from 'node:fs'
import { and, eq, isNull, sql } from 'drizzle-orm'
import puppeteer from 'puppeteer-core'
import { getDb, schema } from '@/server/db'

/**
 * Deleting one process from the list, the way a worker does it: open the row
 * menu, press "מחיקה מהרשימה", read what will happen, confirm — and the row is
 * gone while the supplier stays. A signed person must not be offered the
 * action at all. LOCAL database only; the rows are created by this script.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/remove-invitation-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/remove-invitation'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('refusing: DATABASE_URL is not local')

const db = getDb()
const results: string[] = []
let failed = 0
const check = (ok: boolean, label: string, detail?: string) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}
const stamp = Date.now().toString().slice(-6)

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [g] = await db.select({ id: schema.groups.id, organizationId: schema.groups.organizationId, createdBy: schema.groups.createdBy }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), eq(schema.groups.entryMethod, 'custom'), isNull(schema.groups.systemKey))).orderBy(sql`${schema.groups.createdAt} desc`).limit(1)
  if (!g?.createdBy) throw new Error('no campaign')

  const name = `הזמנת בדיקה למחיקה ${stamp}`
  const [company] = await db.insert(schema.companies).values({ organizationId: g.organizationId, kind: 'supplier', name, source: 'xtra', contactPhone: `+9725000${stamp}` }).returning({ id: schema.companies.id })
  const [agreement] = await db.insert(schema.agreements).values({ organizationId: g.organizationId, ownerId: g.createdBy, companyId: company.id, title: `הסכם — ${name}`, status: 'sent', sentAt: new Date() }).returning({ id: schema.agreements.id })
  const [recipient] = await db.insert(schema.recipients).values({ agreementId: agreement.id, name: 'איש קשר', phone: `+9725000${stamp}` }).returning({ id: schema.recipients.id })
  await db.insert(schema.signingTokens).values({ recipientId: recipient.id, tokenHash: `qa-${stamp}-${crypto.randomUUID()}`.padEnd(64, '0').slice(0, 64), expiresAt: new Date(Date.now() + 86_400_000) })
  const [lead] = await db.insert(schema.projectLeads).values({ organizationId: g.organizationId, groupId: g.id, status: 'invited', source: 'invitation', invitedBy: g.createdBy, data: { name }, companyId: company.id, agreementId: agreement.id, phone: `+9725000${stamp}`, lastActivityAt: new Date() }).returning({ id: schema.projectLeads.id })

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    const list = `${BASE}/projects/${g.id}?tab=joining&view=invitations&q=${encodeURIComponent(String(stamp))}`
    await page.goto(list, { waitUntil: 'networkidle0', timeout: 90000 })
    check((await page.evaluate(() => document.body.innerText)).includes(name), 'the invitation is listed', name)

    const [menu] = await page.$$(`xpath/.//tbody/tr[contains(., "${name}")]//button[@aria-label="פעולות"]`)
    check(Boolean(menu), 'the row has an actions menu')
    await menu!.evaluate((b) => (b as HTMLElement).click())
    await new Promise((r) => setTimeout(r, 400))
    const menuText = await page.$eval('[role="menu"]', (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    check(menuText.includes('מחיקה מהרשימה'), 'the menu offers a delete', menuText)
    await page.screenshot({ path: `${OUT}/1-menu.png` })

    const [item] = await page.$$('xpath/.//div[@role="menu"]//button[contains(., "מחיקה מהרשימה")]')
    await item!.evaluate((b) => (b as HTMLElement).click())
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = await page.$eval('[role="dialog"]', (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    check(dialog.includes('ההסכם שנשלח יבוטל'), 'the question says the agreement will be canceled', dialog)
    check(dialog.includes('יישאר במאגר'), 'the question says the supplier stays')
    await page.screenshot({ path: `${OUT}/2-confirm.png` })

    const [yes] = await page.$$('xpath/.//div[@role="dialog"]//button[contains(., "כן, מחק")]')
    await yes!.evaluate((b) => (b as HTMLElement).click())
    await page.waitForFunction((n) => ![...document.querySelectorAll('tbody tr, li')].some((r) => (r.textContent ?? '').includes(n)), { timeout: 15000 }, name).catch(async () => {
      const shown = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], p')].map((e) => (e.textContent ?? '').trim()).filter((t) => t && t.length < 200).slice(0, 12))
      await page.screenshot({ path: `${OUT}/x-after-confirm.png`, fullPage: true })
      throw new Error(`row still there after confirm. on screen: ${JSON.stringify(shown)}`)
    })
    await new Promise((r) => setTimeout(r, 600))
    const after = await page.evaluate(() => document.body.innerText)
    check(!(await page.evaluate((n) => [...document.querySelectorAll('tbody tr, li')].some((r) => (r.textContent ?? '').includes(n)), name)), 'the row is gone from the list')
    check(after.includes('נמחק מהרשימה'), 'the screen says what happened', after.split('\n').filter((l) => l.includes('נמחק')).join(' '))
    await page.screenshot({ path: `${OUT}/3-after.png` })

    // The database agrees: process gone, agreement canceled, supplier kept.
    check((await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, lead.id))).length === 0, 'the process row is deleted')
    const [a] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, agreement.id))
    check(a.status === 'canceled', 'the agreement is canceled, not deleted', a.status)
    check((await db.select().from(schema.companies).where(eq(schema.companies.id, company.id))).length === 1, 'the supplier stays in the database')

    // A signed person is never offered the action.
    const signed = await db.execute(sql`select pl.id, pl.data->>'name' as name from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${g.id} and a.status = 'signed' limit 1`).then((r) => r.rows[0] as { name: string } | undefined)
    if (signed) {
      await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=all&q=${encodeURIComponent(signed.name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
      const opened = await page.evaluate((n) => {
        const row = [...document.querySelectorAll('tbody tr')].find((r) => (r.textContent ?? '').includes(n))
        const button = row?.querySelector('button[aria-label="פעולות"]') as HTMLElement | undefined
        button?.click()
        return Boolean(button)
      }, signed.name)
      if (opened) {
        await new Promise((r) => setTimeout(r, 400))
        const t = await page.$eval('[role="menu"]', (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        check(!t.includes('מחיקה מהרשימה'), 'a signed person is not offered a delete', t)
        await page.screenshot({ path: `${OUT}/4-signed-menu.png` })
      }
    }
  } finally {
    await browser.close()
    // Children first: the test rows leave nothing behind.
    await db.delete(schema.projectLeads).where(eq(schema.projectLeads.id, lead.id))
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, agreement.id))
    await db.delete(schema.deliveries).where(eq(schema.deliveries.agreementId, agreement.id))
    await db.delete(schema.messageSends).where(eq(schema.messageSends.agreementId, agreement.id))
    await db.delete(schema.signingTokens).where(eq(schema.signingTokens.recipientId, recipient.id))
    await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id))
    await db.delete(schema.agreements).where(eq(schema.agreements.id, agreement.id))
    await db.delete(schema.companyGroups).where(eq(schema.companyGroups.companyId, company.id))
    await db.delete(schema.companies).where(eq(schema.companies.id, company.id))
  }
  console.log(results.join('\n'))
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`REMOVE INVITATION OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  console.log(results.join('\n'))
  process.exit(1)
})
