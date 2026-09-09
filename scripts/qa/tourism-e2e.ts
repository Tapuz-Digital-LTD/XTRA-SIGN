import { writeFileSync, mkdirSync } from 'node:fs'
import postgres from 'postgres'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'
import { TOURISM_WEEKS } from '../../src/lib/self-service-registration'
import { renderPdf, ink, type Box } from './render-pdf'

/**
 * The whole public journey in a real browser against a server with log-only
 * notifications: Page 1 → the four steps of the joining form → sign with the
 * pointer → the code shown by the dev panel → thank-you → download — then
 * the signed file itself, rendered, and the database.
 *
 * Every regional week and both coupon paths are walked, one registration
 * each, because each one leaves a different tick on the Ministry's two-page
 * document, and the only proof a tick landed is to look.
 *
 *   E2E_BASE=http://localhost:3057 E2E_DB=postgres://xtra:xtra@localhost:5433/xtra_sign \
 *     npx tsx scripts/qa/tourism-e2e.ts
 *
 *   E2E_SCENARIOS=quick            two runs (one week per coupon path)
 *   E2E_SCENARIOS=week_3:business_pos_code,week_1:generic_xtra25
 *
 * Against a protected Vercel preview, pass E2E_SHARE_URL (a share link that
 * sets the access cookie) and E2E_DB pointing at the preview database.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const DB = process.env.E2E_DB ?? 'postgres://xtra:xtra@localhost:5433/xtra_sign'
const SHARE = process.env.E2E_SHARE_URL ?? ''
const WIDTH = Number(process.env.E2E_WIDTH ?? 390)
const OUT = process.env.SHOT_OUT ?? '.design/qa/agreement-v2'
const NIL = '00000000-0000-0000-0000-000000000000'

const WEEKS = ['week_1', 'week_2', 'week_3', 'week_4'] as const
const REDEMPTIONS = ['generic_xtra25', 'business_pos_code'] as const
type Week = (typeof WEEKS)[number]
type Redemption = (typeof REDEMPTIONS)[number]
type Scenario = { week: Week; redemption: Redemption; extension: boolean }

function scenarios(): Scenario[] {
  const spec = process.env.E2E_SCENARIOS ?? 'all'
  if (spec === 'quick') return [{ week: 'week_1', redemption: 'generic_xtra25', extension: true }, { week: 'week_2', redemption: 'business_pos_code', extension: false }]
  if (spec === 'all') {
    // The last run unticks the extension, so its box is seen both ways.
    const all = WEEKS.flatMap((week) => REDEMPTIONS.map((redemption) => ({ week, redemption, extension: true })))
    all[all.length - 1].extension = false
    return all
  }
  return spec.split(',').map((s, i) => {
    const [week, redemption] = s.split(':') as [Week, Redemption]
    return { week, redemption, extension: i === 0 }
  })
}

/*
 * Where the stamper puts each tick (src/server/self-service/onboarding.ts):
 * fractions of the page, origin top-left, measured on the 595×842pt artwork.
 */
const box = (xPt: number, yTopPt: number, wPt = 14, hPt = 14): Box => ({ x: xPt / 595, y: yTopPt / 842, w: wPt / 595, h: hPt / 842 })
const WEEK_MARKS: Record<Week, Box> = { week_1: box(310, 205), week_2: box(55, 205), week_3: box(310, 262), week_4: box(55, 262) }
const REDEMPTION_MARKS: Record<Redemption, Box> = { generic_xtra25: box(539, 842 - 244, 11, 11), business_pos_code: box(539, 842 - 214, 11, 11) }
const EXTENSION_MARK = box(541, 842 - 546, 11, 11)

const sql = postgres(DB, { max: 1 })

let failures = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

/** The extension's box, ticked and unticked, across runs: the ticked ones must all carry more ink. */
const extensionInk: { on: number[]; off: number[] } = { on: [], off: [] }

async function journey(browser: Browser, sc: Scenario, first: boolean) {
  const stamp = Date.now()
  const business = `E2E מלון הבדיקה ${stamp}`
  const taxId = String(510000000 + (stamp % 9000000))
  const phone = `052${String(1000000 + (stamp % 8999999))}`
  const contact = 'רונית בדיקה'
  const email = `e2e-${stamp}@example.com`
  const coupon = `E2E-${String(stamp).slice(-6)}`
  const tag = `${sc.week}-${sc.redemption}${sc.extension ? '' : '-noext'}`
  console.log(`\n━━ ${tag} ━━`)

  const page: Page = await browser.newPage()
  // Each run is a different business from a different address, as in life —
  // and the per-IP limiter on registration is a safety, not a thing to loosen.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.77.${Math.floor(stamp / 256) % 256}.${stamp % 256}` })
  let lastRegister = ''
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`  ↳ ${r.request().method()} ${r.url().replace(BASE, '')} ${r.status()}`)
    if (r.url().includes('/register')) lastRegister = `${r.status()}`
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) console.log('  browser:', m.text())
  })
  // Pointer input is driven through the mouse API, so no touch emulation: the
  // pad listens to pointer events either way.
  await page.setViewport({ width: WIDTH, height: 844, deviceScaleFactor: 2 })
  const shot = (name: string) => (first ? page.screenshot({ path: `${OUT}/e2e-${WIDTH}-${name}.png`, fullPage: true }) : Promise.resolve())
  /** "המשך": the step checks itself and the next one appears. */
  const next = async (appears: string) => {
    await page.click('.tj-actions button[type=submit]')
    await page.waitForSelector(appears, { timeout: 15000 })
  }
  const stepNow = () => page.$eval('.tj-steps-now', (el) => el.textContent ?? '')

  if (SHARE) {
    await page.goto(SHARE, { waitUntil: 'networkidle0', timeout: 60000 })
    check('share link opened the protected preview', page.url().startsWith(BASE), page.url())
  }

  // ── Page 1 → Page 2 ────────────────────────────────────────────────────
  await page.goto(`${BASE}/tourism-2026?utm_source=e2e&utm_campaign=local`, { waitUntil: 'networkidle0', timeout: 60000 })
  if (first) {
    const ctaHref = await page.$eval('a.tl-cta', (a) => (a as HTMLAnchorElement).getAttribute('href'))
    check('Page 1 CTA carries the campaign query to the joining page', ctaHref === '/tourism-2026/join?utm_source=e2e&utm_campaign=local', String(ctaHref))
  }
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('a.tl-cta')])
  check('landed on /tourism-2026/join', page.url().includes('/tourism-2026/join'), page.url())
  // Each run is a new business: no draft from the last one.
  await page.evaluate(() => sessionStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })

  // ── Step 1: the business ───────────────────────────────────────────────
  if (first) {
    // "המשך" with nothing typed: the step names its own fields, puts the
    // cursor on the first, and goes nowhere.
    await page.click('.tj-actions button[type=submit]')
    await page.waitForSelector('.tj-error', { timeout: 5000 })
    const errors = await page.$$eval('.tj-error', (els) => els.length)
    const focused = await page.evaluate(() => document.activeElement?.id)
    check('step 1 refuses empty fields inline and focuses the first', errors >= 4 && focused === 'tj-businessName', `${errors} errors, focus on ${focused}`)
    check('still on step 1', (await stepNow()).includes('שלב 1'))
  }
  await page.type('#tj-businessName', business)
  await page.type('#tj-taxId', taxId.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3'))
  await page.type('#tj-email', email)
  await page.type('#tj-contactPerson', contact)
  await page.type('#tj-phone', `${phone.slice(0, 3)}-${phone.slice(3)}`)
  await shot('step1')
  await next('#tj-benefit1')
  check('step 2 reached', (await stepNow()).includes('שלב 2'))

  // ── Step 2: the benefit ────────────────────────────────────────────────
  const benefit1 = await page.$eval('#tj-benefit1', (el) => (el as HTMLInputElement).value)
  check('benefit 1 starts at the minimum, "25% הנחה"', benefit1 === '25% הנחה', benefit1)
  await page.type('#tj-benefit1', ' על לינה')
  check('the generic code is the default', await page.$eval('input[name=redemption][value=generic_xtra25]', (el) => (el as HTMLInputElement).checked))
  if (sc.redemption === 'business_pos_code') {
    await page.click('input[name=redemption][value=business_pos_code]')
    await page.waitForSelector('#tj-couponCode', { timeout: 5000 })
    await page.type('#tj-couponCode', coupon)
  } else {
    check('no coupon number asked on the generic path', (await page.$('#tj-couponCode')) === null)
  }
  await shot('step2')
  await next('#tj-week')

  // ── Step 3: the week ───────────────────────────────────────────────────
  if (first) {
    await page.click('.tj-actions button[type=submit]')
    await page.waitForSelector('#tj-week-error', { timeout: 5000 })
    check('a week is required, said next to the choice', (await stepNow()).includes('שלב 3'))
  }
  await page.click(`input[name=week][value=${sc.week}]`)
  const extension = 'input[type=checkbox]'
  check('the extension starts ticked', await page.$eval(extension, (el) => (el as HTMLInputElement).checked))
  if (!sc.extension) await page.click(extension)
  await shot('step3')
  await next('canvas.tj-pad')

  // ── Step 4: summary, terms, declarations, signatory, signature ─────────
  const signatory = await page.$eval('#tj-signatoryName', (el) => (el as HTMLInputElement).value)
  check('signatory pre-filled from the contact person', signatory === contact, signatory)
  check('both declarations start ticked', await page.$$eval('#tj-declareLicense, #tj-declareInsurance', (els) => els.every((e) => (e as HTMLInputElement).checked)))
  const weekTitle = TOURISM_WEEKS.find((w) => w.id === sc.week)!.title
  const summary = await page.$eval('.tj-summary', (el) => el.textContent ?? '')
  check('summary names the business, the week and the coupon path', summary.includes(business) && summary.includes(weekTitle) && (sc.redemption === 'business_pos_code' ? summary.includes(coupon) : summary.includes('XTRA25')))
  if (first) {
    // "עריכה" goes back to step 1 with everything kept, and three "המשך" return here.
    await page.click('.tj-summary-edit')
    await page.waitForSelector('#tj-businessName', { timeout: 5000 })
    const kept = await page.$eval('#tj-businessName', (el) => (el as HTMLInputElement).value)
    check('edit from the summary returns to step 1 with the value kept', kept === business)
    await next('#tj-benefit1')
    await next('#tj-week')
    await next('canvas.tj-pad')
  }
  await page.type('#tj-signatoryRole', 'מנכ"ל')

  // Submit without a signature: refused on the page, nothing sent.
  await page.click('.tj-actions button[type=submit]')
  await page.waitForSelector('.tj-alert', { timeout: 5000 })
  const alertText = await page.$eval('.tj-alert', (el) => el.textContent ?? '')
  check('refuses to send without a signature', alertText.includes('לחתום'), alertText)

  // The signature, with the pointer.
  const pad = await page.$('canvas.tj-pad')
  await page.evaluate(() => document.querySelector('canvas.tj-pad')?.scrollIntoView({ block: 'center' }))
  await new Promise((r) => setTimeout(r, 800))
  const pb = (await pad!.boundingBox())!
  await page.mouse.move(pb.x + pb.width * 0.2, pb.y + pb.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(pb.x + pb.width * (0.2 + i * 0.03), pb.y + pb.height * (0.6 + Math.sin(i / 2) * 0.15))
  await page.mouse.up()
  check('signature registered on the pad', (await page.$eval('.tj-pad-clear', (b) => (b as HTMLButtonElement).disabled)) === false)
  await page.click('.tj-consent input[type=checkbox]:not(#tj-declareLicense):not(#tj-declareInsurance)')
  await shot('step4')

  // Double click: one registration.
  await page.click('.tj-actions button[type=submit]')
  await page.click('.tj-actions button[type=submit]').catch(() => {})
  try {
    await page.waitForSelector('#tj-code', { timeout: 60000 })
  } catch (error) {
    await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-${tag}-fail.png`, fullPage: true })
    console.log('no OTP panel; register answered', lastRegister || '(nothing)', 'alert:', await page.$eval('.tj-alert', (el) => el.textContent).catch(() => null))
    throw error
  }
  check('OTP panel shown', true)
  await shot('otp')

  const devCode = await page.$eval('.tj-devcode strong', (el) => el.textContent?.trim() ?? '').catch(() => '')
  check('dev code shown (log-only mode)', /^\d{6}$/.test(devCode), devCode)
  if (first) {
    await page.type('#tj-code', '000000')
    await page.click('.tj-otp .tj-primary')
    await page.waitForFunction(() => document.querySelector('.tj-otp .tj-alert')?.textContent?.includes('שגוי'), { timeout: 15000 })
    check('wrong code refused', true)
    await page.focus('#tj-code')
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  }
  await page.type('#tj-code', devCode)
  await page.click('.tj-otp .tj-primary')
  try {
    await page.waitForFunction(() => window.location.pathname.startsWith('/tourism-2026/thanks/'), { timeout: 90000 })
  } catch (error) {
    await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-${tag}-fail.png`, fullPage: true })
    console.log('stuck at', page.url(), 'alert:', await page.$eval('.tj-otp .tj-alert', (el) => el.textContent).catch(() => null))
    throw error
  }
  await page.waitForSelector('a.tj-primary', { timeout: 30000 })
  check('landed on the thank-you page', /\/tourism-2026\/thanks\/[A-Za-z0-9_-]+$/.test(page.url()), page.url())
  await shot('thanks')
  check('the draft is gone once the process left the form', await page.evaluate(() => Object.keys(sessionStorage).every((k) => !k.startsWith('xs-join:'))))

  // ── Download: our route, then the storage URL it redirects to ──────────
  const downloadHref = await page.$eval('a.tj-primary', (a) => (a as HTMLAnchorElement).href)
  const token = page.url().split('/').pop()!
  const cookieHeader = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const hop = await fetch(downloadHref, { headers: { cookie: cookieHeader }, redirect: 'manual' })
  const location = hop.headers.get('location')
  check('download route redirects to a signed storage URL', hop.status === 302 && Boolean(location), `${hop.status} ${location ? new URL(location).host : ''}`)
  const file = location ? await fetch(location) : hop
  const bytes = Buffer.from(await file.arrayBuffer())
  check('download answers 200 with a PDF', file.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-', String(file.status))

  // ── The signed file ────────────────────────────────────────────────────
  check('the signed file has the document\'s two pages', (await PDFDocument.load(bytes)).getPageCount() === 2)
  const text = await extractPdfText(bytes)
  check('signed PDF carries the tax id', text.includes(taxId))
  check('signed PDF carries the phone', text.includes(`${phone.slice(0, 3)}-${phone.slice(3)}`))
  check('signed PDF carries the email', text.includes(email))
  check('signed PDF keeps the printed legal copy', text.includes('XTRA25'))
  if (sc.redemption === 'business_pos_code') check('signed PDF carries the business\'s coupon number', text.includes(coupon))

  const [p1, p2] = await renderPdf(bytes, 2)
  writeFileSync(`${OUT}/signed-${tag}.pdf`, bytes)
  if (first || sc.redemption === 'business_pos_code' || !sc.extension) {
    writeFileSync(`${OUT}/signed-${tag}-p1.png`, p1.png)
    writeFileSync(`${OUT}/signed-${tag}-p2.png`, p2.png)
  }
  const weekInk = WEEKS.map((w) => ink(p2, WEEK_MARKS[w]))
  const chosen = weekInk[WEEKS.indexOf(sc.week)]
  check(`the tick is under ${sc.week} and under no other week`, chosen > 20 && weekInk.every((v, i) => WEEKS[i] === sc.week || v < chosen / 3), weekInk.join(' / '))
  const other: Redemption = sc.redemption === 'generic_xtra25' ? 'business_pos_code' : 'generic_xtra25'
  const rc = ink(p1, REDEMPTION_MARKS[sc.redemption])
  const ro = ink(p1, REDEMPTION_MARKS[other])
  check(`the coupon choice ${sc.redemption} is ticked, the other is not`, rc > ro * 1.3, `${rc} vs ${ro}`)
  extensionInk[sc.extension ? 'on' : 'off'].push(ink(p2, EXTENSION_MARK))

  // ── Returning through the links after signing ──────────────────────────
  if (first) {
    await page.goto(`${BASE}/tourism-2026/sign/${token}`, { waitUntil: 'networkidle0', timeout: 60000 })
    check('signed link lands on the thank-you page', page.url().includes('/tourism-2026/thanks/'), page.url())
    await page.goto(`${BASE}/sign/${token}`, { waitUntil: 'networkidle0', timeout: 60000 })
    check('/sign/[token] hands over to the campaign', page.url().includes('/tourism-2026/'), page.url())
  }
  await page.close()

  // ── Database ───────────────────────────────────────────────────────────
  const [supplier] = await sql`select id, kind, contact_name, contact_phone, contact_email from companies where tax_id = ${taxId} and deleted_at is null`
  check('one supplier created, whose contact is the contact person', supplier?.contact_name === contact, JSON.stringify(supplier))
  const agreements = await sql`select id, status, title from agreements where company_id = ${supplier?.id ?? NIL}`
  check('exactly one agreement, signed', agreements.length === 1 && agreements[0].status === 'signed', JSON.stringify(agreements))
  const agreementId = agreements[0]?.id ?? NIL
  const [version] = await sql`select page_count from agreement_versions where agreement_id = ${agreementId}`
  check('the version is the two-page document', version?.page_count === 2, JSON.stringify(version))
  const [registration] = await sql`select status, source, meta, data from project_leads where data->>'taxId' = ${taxId}`
  check('registration converted, with its meta and the contact person', registration?.status === 'converted' && registration?.meta?.utm_source === 'e2e' && registration?.data?.contactPerson === contact, JSON.stringify(registration?.meta))
  const membership = await sql`select 1 from company_groups cg join groups g on g.id = cg.group_id where cg.company_id = ${supplier?.id ?? NIL} and g.name = 'חודש התיירות הישראלית 2026'`
  check('supplier is in the project', membership.length === 1)
  const audit = await sql`select type from audit_events where agreement_id = ${agreementId} order by created_at`
  const types = audit.map((a) => a.type)
  check('audit trail: sent, otp, signature, completed', ['sent', 'otp_sent', 'otp_verified', 'signature_applied', 'completed'].every((t) => types.includes(t)), types.join(','))
  const [signature] = await sql`select method from signatures s join agreement_versions v on v.id = s.agreement_version_id where v.agreement_id = ${agreementId}`
  check('signature recorded as drawn', signature?.method === 'drawn')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const list = scenarios()
  for (const [i, sc] of list.entries()) await journey(browser, sc, i === 0)
  await browser.close()
  if (extensionInk.on.length && extensionInk.off.length) {
    check('the extension box carries more ink ticked than unticked', Math.min(...extensionInk.on) > Math.max(...extensionInk.off) * 1.3, `on ${extensionInk.on.join('/')} · off ${extensionInk.off.join('/')}`)
  }
  console.log(failures === 0 ? `\nALL GREEN (${list.length} runs)` : `\n${failures} FAILED`)
  await sql.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await sql.end()
  process.exit(1)
})
