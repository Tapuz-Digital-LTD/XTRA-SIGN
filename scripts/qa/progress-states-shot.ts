import { mkdirSync } from 'node:fs'
import { and, eq, like, sql } from 'drizzle-orm'
import puppeteer, { type Page } from 'puppeteer-core'
import { getDb, schema } from '@/server/db'

/**
 * The four questions a worker asks about a supplier who has not signed, each
 * built from real rows on the LOCAL database and then read back off the
 * screen: a code that was sent and never entered, a link that was opened
 * without a code, a code that was verified without a signature, and a
 * finished signature. Checks the row line, the drawer panel, and that no
 * screen ever claims a message was delivered.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/progress-states-shot.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/progress-states'
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
const t = (m: number) => new Date(Date.now() - m * 60_000)

type Case = { key: string; name: string; expectRow: string; expectHeadline: string; steps: { done: string[]; notDone: string[] } }

async function build(orgId: string, userId: string, groupId: string, c: Case & { status: 'sent' | 'viewed' | 'signed'; opened?: boolean; verified?: boolean; signed?: boolean }) {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: c.name, source: 'xtra', contactName: 'איש קשר', contactPhone: `+9725000${stamp}`, contactEmail: `${c.key}-${stamp}@example.com` }).returning({ id: schema.companies.id })
  const [agreement] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: `הסכם — ${c.name}`, status: c.status, sentAt: t(60), completedAt: c.signed ? t(5) : null, expiresAt: t(-30 * 24 * 60) }).returning({ id: schema.agreements.id })
  const [recipient] = await db.insert(schema.recipients).values({ agreementId: agreement.id, name: 'איש קשר', company: c.name, phone: `+9725000${stamp}`, email: `${c.key}-${stamp}@example.com`, verifiedAt: c.verified ? t(20) : null, verifiedVia: c.verified ? 'sms_otp' : null, signedAt: c.signed ? t(5) : null }).returning({ id: schema.recipients.id })
  const [lead] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: c.name, contactName: 'איש קשר', phone: `+9725000${stamp}` }, formSnapshot: [{ id: 'name', label: 'שם העסק' }], companyId: company.id, agreementId: agreement.id, phone: `+9725000${stamp}`, lastActivityAt: t(5) }).returning({ id: schema.projectLeads.id })
  await db.insert(schema.companyGroups).values({ groupId, companyId: company.id }).onConflictDoNothing()
  await db.insert(schema.messageSends).values({ organizationId: orgId, groupId, agreementId: agreement.id, leadId: lead.id, channel: 'sms', event: 'registration_completed', recipient: `+9725000${stamp}`, body: 'קישור לחתימה', ok: true, sentAt: t(55) })
  await db.insert(schema.auditEvents).values({ agreementId: agreement.id, recipientId: recipient.id, type: 'otp_sent', actor: 'signer', metadata: { channel: 'sms', delivered: true }, createdAt: t(54) })
  if (c.opened) await db.insert(schema.auditEvents).values({ agreementId: agreement.id, recipientId: recipient.id, type: 'viewed', actor: 'signer', createdAt: t(30) })
  if (c.verified) await db.insert(schema.auditEvents).values({ agreementId: agreement.id, recipientId: recipient.id, type: 'otp_verified', actor: 'signer', createdAt: t(20) })
  return { leadId: lead.id, agreementId: agreement.id, companyId: company.id }
}

async function readRow(page: Page, name: string) {
  return page.evaluate((n) => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => (r.textContent ?? '').includes(n))
    if (!row) return null
    const cells = [...row.querySelectorAll('td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())
    return { cells, text: (row.textContent ?? '').replace(/\s+/g, ' ').trim() }
  }, name)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [g] = await db.select({ id: schema.groups.id, organizationId: schema.groups.organizationId, createdBy: schema.groups.createdBy }).from(schema.groups).where(and(sql`${schema.groups.deletedAt} is null`, eq(schema.groups.entryMethod, 'custom'), sql`${schema.groups.systemKey} is null`)).orderBy(sql`${schema.groups.createdAt} desc`).limit(1)
  if (!g) throw new Error('no campaign')

  const cases: (Case & { status: 'sent' | 'viewed' | 'signed'; opened?: boolean; verified?: boolean; signed?: boolean })[] = [
    { key: 'code-sent', name: `מצב קוד נשלח ${stamp}`, status: 'sent', expectRow: 'קישור וקוד נשלחו · טרם נפתח', expectHeadline: 'ממתין להשלמת חתימה', steps: { done: ['קוד אימות נשלח'], notDone: ['קוד האימות אומת', 'החתימה הושלמה'] } },
    { key: 'link-opened', name: `מצב קישור נפתח ${stamp}`, status: 'viewed', opened: true, expectRow: 'קישור נפתח · טרם הושלמה חתימה', expectHeadline: 'ממתין להשלמת חתימה', steps: { done: ['הקישור להסכם נפתח'], notDone: ['קוד האימות אומת', 'החתימה הושלמה'] } },
    { key: 'code-verified', name: `מצב קוד אומת ${stamp}`, status: 'viewed', opened: true, verified: true, expectRow: 'קוד אומת · טרם הושלמה חתימה', expectHeadline: 'ממתין להשלמת חתימה', steps: { done: ['קוד האימות אומת'], notDone: ['החתימה הושלמה'] } },
    { key: 'signed', name: `מצב נחתם ${stamp}`, status: 'signed', opened: true, verified: true, signed: true, expectRow: '', expectHeadline: 'ההצטרפות הושלמה', steps: { done: ['החתימה הושלמה'], notDone: [] } },
  ]
  const built = new Map<string, Awaited<ReturnType<typeof build>>>()
  if (!g.createdBy) throw new Error('campaign has no owner')
  for (const c of cases) built.set(c.key, await build(g.organizationId, g.createdBy, g.id, c))

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    for (const c of cases) {
      // A supplier who joined through the campaign page lives in הרשמות.
      await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=registrations&q=${encodeURIComponent(c.name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
      const inRegistrations = await readRow(page, c.name)
      check(Boolean(inRegistrations), `${c.key}: listed in הרשמות`, c.name)
      if (inRegistrations && c.expectRow) check(inRegistrations.text.includes(c.expectRow), `${c.key}: הרשמות row says "${c.expectRow}"`, inRegistrations.text.slice(0, 160))
      await page.screenshot({ path: `${OUT}/${c.key}-registrations.png` })

      // …and never in הזמנות ומעקב, which is our own outreach only.
      await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=invitations&q=${encodeURIComponent(c.name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
      check(!(await page.evaluate(() => document.body.innerText)).includes(c.name), `${c.key}: not shown in הזמנות ומעקב`)

      await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=all&q=${encodeURIComponent(c.name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
      const row = await readRow(page, c.name)
      check(Boolean(row), `${c.key}: the row is listed`, c.name)
      if (row) {
        if (c.expectRow) check(row.text.includes(c.expectRow), `${c.key}: row line says "${c.expectRow}"`, row.text.slice(0, 180))
        check(row.text.includes('ממתין לחתימה') || row.text.includes('חתם'), `${c.key}: the status chip stays short`, row.cells[3] ?? '')
        check(!row.text.includes('נמסר'), `${c.key}: the row never claims delivery`)
      }
      await page.screenshot({ path: `${OUT}/${c.key}-row.png` })

      // The list may hold more than the searched row: open the one that is this case.
      const [target] = await page.$$(`xpath/.//tbody/tr[contains(., "${c.name}")]`)
      if (target) {
        await target.evaluate((tr) => (tr as HTMLElement).click())
        await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
        await new Promise((r) => setTimeout(r, 700))
        const text = await page.$eval('[role="dialog"]', (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        check(text.includes(c.expectHeadline), `${c.key}: drawer headline "${c.expectHeadline}"`, text.slice(0, 160))
        for (const step of c.steps.done) check(text.includes(step) && !text.includes(`${step} — טרם`), `${c.key}: "${step}" is shown as done`)
        for (const step of c.steps.notDone) check(text.includes(`${step} — טרם`), `${c.key}: "${step}" is shown as not done`)
        check(!text.includes('נמסר'), `${c.key}: drawer never claims delivery`)
        check(!/\b(otp|viewed|sent|converted)\b/i.test(text.replace(/[A-Za-z]+@[^\s]+/g, '')), `${c.key}: no system words in the drawer`)
        await page.screenshot({ path: `${OUT}/${c.key}-drawer.png` })
        await page.keyboard.press('Escape')
      }
    }

    // The company card tells the same story.
    const one = built.get('link-opened')!
    await page.goto(`${BASE}/companies/${one.companyId}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const card = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    check(card.includes('מצב ההצטרפות'), 'company card shows the joining state')
    check(card.includes('קישור נפתח') || card.includes('ממתין להשלמת חתימה'), 'company card uses the same words', card.slice(0, 160))
    await page.screenshot({ path: `${OUT}/company-card.png` })

    // Phone width: the same line, no sideways scroll.
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${BASE}/projects/${g.id}?tab=joining&view=registrations&q=${encodeURIComponent(cases[2].name)}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const spill = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    check(!spill, 'phone: no sideways scroll')
    check((await page.evaluate(() => document.body.innerText)).includes('קוד אומת'), 'phone: the proven step is on the card')
    await page.screenshot({ path: `${OUT}/phone-waiting.png`, fullPage: true })
  } finally {
    await browser.close()
    // Test rows go away; nothing here belongs in a real campaign.
    for (const b of built.values()) {
      await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, b.agreementId))
      await db.delete(schema.messageSends).where(eq(schema.messageSends.agreementId, b.agreementId))
      await db.delete(schema.projectLeads).where(eq(schema.projectLeads.id, b.leadId))
      await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, b.agreementId))
      await db.delete(schema.agreements).where(eq(schema.agreements.id, b.agreementId))
      await db.delete(schema.companyGroups).where(eq(schema.companyGroups.companyId, b.companyId))
      await db.delete(schema.companies).where(eq(schema.companies.id, b.companyId))
    }
    await db.delete(schema.companies).where(like(schema.companies.name, `%${stamp}`))
    results.push('test rows removed')
  }
  console.log(results.join('\n'))
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`PROGRESS STATES OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  console.log(results.join('\n'))
  process.exit(1)
})
