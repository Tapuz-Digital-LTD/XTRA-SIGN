import { mkdirSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { getDb } from '@/server/db'

/**
 * The owner's experiment, reproduced on the LOCAL database with TEST data:
 *   A. type into the form and leave before pressing the button
 *   B. submit, reach the code step, leave; then open the link once (→ "viewed")
 *   C. the whole thing, code and all (log-only OTP), for comparison
 * After each case the script prints exactly which rows appeared, and what the
 * staff screens show for that person. Refuses to run against anything but a
 * local database.
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/abandon-repro.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SLUG = process.env.SLUG ?? 'tourism-2026'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/abandon-repro'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LINK_AFTER_MS = Number(process.env.SIGN_SELF_SERVICE_LINK_AFTER_MS ?? 4 * 60 * 1000)
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('refusing: DATABASE_URL is not local')

const db = getDb()
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[]
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stamp = Date.now().toString().slice(-6)
const log = (s: string) => console.log(s)

async function rowsSince(groupId: string, since: Date, label: string) {
  const out: Record<string, unknown> = {}
  out.project_leads = await rows(sql`select id, status, source, form_snapshot is not null as submitted, company_id is not null as has_company, agreement_id, data->>'name' as name, created_at from project_leads where group_id = ${groupId} and created_at >= ${since} order by created_at`)
  out.companies = await rows(sql`select c.id, c.name, c.kind, c.created_at, (select count(*) from company_groups cg where cg.company_id = c.id and cg.group_id = ${groupId}) as in_group from companies c where c.created_at >= ${since} and c.deleted_at is null order by c.created_at`)
  out.agreements = await rows(sql`select a.id, a.status, a.sent_at, a.completed_at, a.expires_at from agreements a where a.created_at >= ${since} and a.merge_snapshot->'selfService'->>'projectId' = ${groupId} order by a.created_at`)
  out.recipients = await rows(sql`select r.id, r.verified_at, r.viewed_at, r.signed_at from recipients r join agreements a on a.id = r.agreement_id where a.created_at >= ${since} and a.merge_snapshot->'selfService'->>'projectId' = ${groupId}`)
  out.signing_tokens = (await rows(sql`select count(*) as n from signing_tokens t where t.created_at >= ${since}`))[0]?.n
  out.otp_challenges = await rows(sql`select o.attempts, o.consumed_at is not null as consumed, o.created_at from otp_challenges o where o.created_at >= ${since}`)
  out.audit_types = (await rows(sql`select string_agg(e.type || '@' || to_char(e.created_at, 'HH24:MI:SS'), ', ' order by e.created_at) as t from audit_events e join agreements a on a.id = e.agreement_id where e.created_at >= ${since} and a.merge_snapshot->'selfService'->>'projectId' = ${groupId}`))[0]?.t
  out.deliveries = await rows(sql`select d.channel, d.status, d.sent_at from deliveries d join agreements a on a.id = d.agreement_id where d.created_at >= ${since} and a.merge_snapshot->'selfService'->>'projectId' = ${groupId} order by d.created_at`)
  out.message_sends = await rows(sql`select channel, event, ok, sent_at from message_sends where group_id = ${groupId} and sent_at >= ${since} order by sent_at`)
  out.campaign_events = (await rows(sql`select string_agg(type || '@' || to_char(created_at, 'HH24:MI:SS'), ', ' order by created_at) as t from campaign_events where group_id = ${groupId} and created_at >= ${since}`))[0]?.t
  out.follow_up_tasks = await rows(sql`select kind, status, created_at from follow_up_tasks where group_id = ${groupId} and created_at >= ${since}`)
  out.signatures = (await rows(sql`select count(*) as n from signatures s where s.signed_at >= ${since}`))[0]?.n
  log(`\n## DB rows created since case ${label} started`)
  for (const [k, v] of Object.entries(out)) log(`${k}: ${JSON.stringify(v)}`)
  return out
}

async function fill(page: Page, v: Record<string, string>) {
  for (const [field, value] of Object.entries(v)) {
    await page.$eval(`#tj-${field}`, (el) => ((el as HTMLInputElement).value = ''))
    await page.type(`#tj-${field}`, value)
  }
}
async function sign(page: Page) {
  const canvas = await page.$('form canvas')
  if (!canvas) throw new Error('no signature canvas')
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await wait(400)
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 12, box.y + box.height / 2 + Math.sin(i) * 12, { steps: 2 })
  await page.mouse.up()
  const boxes = await page.$$('form input[type="checkbox"]')
  for (const b of boxes) await b.evaluate((el) => (el as HTMLElement).click())
}
async function submitAndWaitForCode(page: Page) {
  let register: Record<string, unknown> | null = null
  page.on('response', async (res) => {
    if (res.url().includes('/register') && res.request().method() === 'POST') register = await res.json().catch(() => null)
  })
  const responses: string[] = []
  page.on('response', (res) => {
    if (res.url().includes('/api/')) responses.push(`${res.request().method()} ${res.url().replace(BASE, '')} ${res.status()}`)
  })
  await page.click('form button[type="submit"]')
  try {
    await page.waitForSelector('#tj-code', { timeout: 30000 })
  } catch {
    const state = await page.evaluate(() => ({ errors: [...document.querySelectorAll('.tj-error')].map((e) => e.textContent?.trim()).filter(Boolean), message: [...document.querySelectorAll('p, div')].map((e) => e.textContent?.trim() ?? '').filter((t) => /יש ל|לא הצלחנו|נסו|קוד/.test(t) && t.length < 160).slice(0, 5), checked: [...document.querySelectorAll('form input[type="checkbox"]')].map((c) => (c as HTMLInputElement).checked), buttons: [...document.querySelectorAll('form button')].map((b) => `${b.textContent?.trim()}:${(b as HTMLButtonElement).disabled}`) }))
    await page.screenshot({ path: `${OUT}/submit-failed.png`, fullPage: true })
    throw new Error(`no code step. responses=${JSON.stringify(responses)} register=${JSON.stringify(register)} state=${JSON.stringify(state)}`)
  }
  await wait(800)
  return register as Record<string, unknown> | null
}

async function staffLooks(browser: Browser, groupId: string, name: string, tag: string) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
  const q = encodeURIComponent(name)
  const screens = [
    ['overview', `/projects/${groupId}`],
    ['joining-waiting', `/projects/${groupId}?tab=joining&view=waiting&q=${q}`],
    ['joining-registrations', `/projects/${groupId}?tab=joining&view=registrations&q=${q}`],
    ['joining-all', `/projects/${groupId}?tab=joining&view=all&q=${q}`],
    ['audience', `/projects/${groupId}?tab=audience&q=${q}`],
    ['agreements', `/projects/${groupId}?tab=agreements&filter=pending`],
    ['setup', `/projects/${groupId}?tab=setup`],
  ]
  log(`\n## staff screens for "${name}"`)
  for (const [key, url] of screens) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const found = await page.evaluate((n) => ({
      present: document.body.innerText.includes(n),
      chips: (() => {
        const first = [...document.querySelectorAll('tbody tr, li')].find((el) => (el.textContent ?? '').includes(n))
        return first ? [...first.querySelectorAll('span')].map((s) => (s.textContent ?? '').trim()).filter((t) => t && t.length < 24).slice(0, 8) : []
      })(),
      cards: [...document.querySelectorAll('a, div')].filter((el) => /ממתינים להשלמה|הרשמות שהתקבלו|הסכמים שנחתמו|דורשים טיפול/.test(el.textContent ?? '') && el.children.length <= 3 && (el.textContent ?? '').length < 60).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 4),
    }), name)
    log(`${key}: present=${found.present}${found.chips.length ? ` chips=${JSON.stringify(found.chips)}` : ''}${key === 'overview' ? ` cards=${JSON.stringify(found.cards)}` : ''}`)
    await page.screenshot({ path: `${OUT}/${tag}-${key}.png` })
  }
  await page.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [g] = await rows(sql`select id from groups where deleted_at is null and entry_method = 'custom' and system_key is null order by created_at desc limit 1`)
  const groupId = g.id as string
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const only = process.env.ONLY ?? ''
    let page: Page
    let nameB = ''
    let submittedB = new Date()
    if (only !== 'C') {
    // ── A: type, leave before the button ───────────────────────────────────
    const startA = new Date()
    const nameA = `בדיקת נטישה A ${stamp}`
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(`${BASE}/${SLUG}/join`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.waitForSelector('#tj-businessName', { timeout: 20000 })
    await fill(page, { businessName: nameA, phone: '0521234567', taxId: '512345678' })
    await wait(1500)
    await page.screenshot({ path: `${OUT}/a-typed.png` })
    await page.close()
    await wait(1000)
    await rowsSince(groupId, startA, 'A (typed, left before submit)')

    // ── B: submit, leave at the code step, then open the link once ─────────
    const startB = new Date()
    nameB = `בדיקת נטישה B ${stamp}`
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(`${BASE}/${SLUG}/join`, { waitUntil: 'networkidle0', timeout: 90000 })
    await fill(page, { businessName: nameB, taxId: `51${stamp}0`, signatoryName: 'בודק נטישה', signatoryRole: 'בעלים', phone: `052${stamp}7`, email: `abandon-b-${stamp}@example.com` })
    await sign(page)
    const regB = await submitAndWaitForCode(page)
    submittedB = new Date()
    log(`\nregister response B: ${JSON.stringify({ ...regB, token: regB?.token ? '(token)' : null })}`)
    await page.screenshot({ path: `${OUT}/b-otp-step.png` })
    await page.close()
    await wait(1200)
    await rowsSince(groupId, startB, 'B (submitted, left at the code step)')

    const tokenB = regB?.token as string | undefined
    if (tokenB) {
      const signer = await browser.newPage()
      await signer.setViewport({ width: 1280, height: 900 })
      await signer.goto(`${BASE}/${SLUG}/sign/${tokenB}`, { waitUntil: 'networkidle0', timeout: 90000 })
      await signer.screenshot({ path: `${OUT}/b-link-opened.png` })
      await signer.close()
      await wait(800)
      log(`\n## B after the link was opened once (no code entered)`)
      log(JSON.stringify(await rows(sql`select a.status, (select string_agg(e.type, ', ' order by e.created_at) from audit_events e where e.agreement_id = a.id) as audit from agreements a join project_leads pl on pl.agreement_id = a.id where pl.data->>'name' = ${nameB}`)))
    }
    await staffLooks(browser, groupId, nameB, 'b')
    } else {
      const [b] = await rows(sql`select data->>'name' as name, created_at from project_leads where group_id = ${groupId} and data->>'name' like 'בדיקת נטישה B %' order by created_at desc limit 1`)
      nameB = b.name as string
      submittedB = new Date(b.created_at as string)
    }

    // ── C: the whole thing ─────────────────────────────────────────────────
    const startC = new Date()
    const nameC = `בדיקת השלמה C ${stamp}`
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(`${BASE}/${SLUG}/join`, { waitUntil: 'networkidle0', timeout: 90000 })
    await fill(page, { businessName: nameC, taxId: `52${stamp}0`, signatoryName: 'בודק השלמה', signatoryRole: 'בעלים', phone: `053${stamp}7`, email: `complete-c-${stamp}@example.com` })
    await sign(page)
    const regC = await submitAndWaitForCode(page)
    const code = (regC?.otp as { devCode?: string } | undefined)?.devCode
    if (code) {
      await page.type('#tj-code', code)
      await wait(500)
      const [go] = await page.$$('xpath/.//button[contains(., "אימות והשלמת החתימה")]')
      if (go) await go.evaluate((b) => (b as HTMLElement).click()).catch(() => null)
      await page.waitForFunction(() => location.pathname.includes('/thanks/') || document.body.innerText.includes('תודה'), { timeout: 40000 }).catch(() => null)
      await wait(1500)
      await page.screenshot({ path: `${OUT}/c-after-signing.png` })
      log(`\nC finished at ${page.url()}`)
    } else log('\nC: no dev code in the response (log-only OTP off) — completion not reproduced')
    await page.close()
    await wait(1500)
    await rowsSince(groupId, startC, 'C (completed)')
    await staffLooks(browser, groupId, nameC, 'c')

    // ── B's deferred "come back and sign" message ──────────────────────────
    const due = submittedB.getTime() + LINK_AFTER_MS + 25_000 - Date.now()
    if (due > 0) {
      log(`\nwaiting ${Math.round(due / 1000)}s for B's deferred message window (${LINK_AFTER_MS / 1000}s after submit)…`)
      await wait(due)
    }
    log(`\n## B after the deferred window`)
    log(JSON.stringify(await rows(sql`select a.status, (select string_agg(ms.channel || '/' || ms.event || '/ok=' || ms.ok::text, ', ' order by ms.sent_at) from message_sends ms where ms.agreement_id = a.id) as sends, (select string_agg(e.type, ', ' order by e.created_at) from audit_events e where e.agreement_id = a.id) as audit from agreements a join project_leads pl on pl.agreement_id = a.id where pl.data->>'name' = ${nameB}`)))
  } finally {
    await browser.close()
  }
  log(`\nABANDON REPRO DONE → ${OUT}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
