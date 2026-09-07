// NOTE: page.$eval is Puppeteer DOM querying (querySelector + callback in the page), not JS eval().
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import postgres from 'postgres'
import puppeteer from 'puppeteer-core'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'

/**
 * One controlled registration on PRODUCTION with the owner's own details:
 * landing → join → signature → submit → the real OTP SMS lands on the
 * owner's phone → the code is typed into a file → the script types it in →
 * thank-you → secure download → the PDF → the database, the mail
 * snapshots and the notifications.
 *
 * It never invents a phone number. Two ways to finish the OTP step:
 *   1. write the 6-digit code to CODE_FILE (the script polls for ~4.5 min), or
 *   2. sign on the phone from the SMS link — the script notices the agreement
 *      turning "signed" in the database and verifies from there.
 *
 *   E2E_BASE=https://xtra-sign.vercel.app E2E_DB=<prod unpooled url> \
 *   SMOKE_PHONE=05xxxxxxxx SMOKE_EMAIL=you@xtra.co.il CODE_FILE=/path/otp-code.txt \
 *     npx tsx scripts/qa/tourism-prod-smoke.ts
 */
const BASE = process.env.E2E_BASE ?? ''
const DB = process.env.E2E_DB ?? ''
const PHONE = (process.env.SMOKE_PHONE ?? '').replace(/\D/g, '')
const EMAIL = process.env.SMOKE_EMAIL ?? ''
const BUSINESS = process.env.SMOKE_BUSINESS ?? `XTRA בדיקת מערכת ${new Date().toISOString().slice(0, 16)}`
const CODE_FILE = process.env.CODE_FILE ?? ''
const OUT = process.env.SHOT_OUT ?? '.design/qa/prod-smoke'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!BASE || !DB || !PHONE || !EMAIL || !CODE_FILE) throw new Error('E2E_BASE, E2E_DB, SMOKE_PHONE, SMOKE_EMAIL and CODE_FILE are required')
if (!/^05\d{8}$/.test(PHONE)) throw new Error('SMOKE_PHONE must be an Israeli mobile (05xxxxxxxx) — your own')
mkdirSync(OUT, { recursive: true })

const sql = postgres(DB, { max: 1 })
let failures = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const state = (patch: Record<string, unknown>) => {
  const p = `${OUT}/state.json`
  const cur = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
  writeFileSync(p, JSON.stringify({ ...cur, ...patch, updatedAt: new Date().toISOString() }, null, 2))
}

async function main() {
  const stamp = Date.now()
  const taxId = String(510000000 + (stamp % 9000000))
  state({ taxId, business: BUSINESS, startedAt: new Date().toISOString() })

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`  ↳ ${r.request().method()} ${r.url().replace(BASE, '')} ${r.status()}`)
  })

  // ── Landing → join ─────────────────────────────────────────────────────
  const landing = await page.goto(`${BASE}/tourism-2026?utm_source=smoke&utm_campaign=golive`, { waitUntil: 'networkidle0', timeout: 60000 })
  check('landing answers 200 over https', landing?.status() === 200 && page.url().startsWith('https://'), `${landing?.status()} ${page.url()}`)
  check('no XTRA Sign chrome on the campaign page', !(await page.evaluate(() => document.body.textContent?.includes('XTRA Sign'))))
  await page.screenshot({ path: `${OUT}/1-landing.png` })
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('a.tl-cta')])
  check('join page reached', page.url().includes('/tourism-2026/join'), page.url())
  await page.screenshot({ path: `${OUT}/2-join.png` })

  // ── Form ───────────────────────────────────────────────────────────────
  await page.type('#tj-businessName', BUSINESS)
  await page.type('#tj-taxId', taxId.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3'))
  await page.type('#tj-phone', `${PHONE.slice(0, 3)}-${PHONE.slice(3)}`)
  await page.type('#tj-email', EMAIL)
  await page.type('#tj-signatoryName', 'תומר סנדרוסי')
  await page.type('#tj-signatoryRole', 'מנכ"ל')
  const pad = await page.$('canvas.tj-pad')
  await page.evaluate(() => document.querySelector('canvas.tj-pad')?.scrollIntoView({ block: 'center' }))
  await wait(800)
  const box = await pad!.boundingBox()
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(box!.x + box!.width * (0.2 + i * 0.03), box!.y + box!.height * (0.6 + Math.sin(i / 2) * 0.15))
  await page.mouse.up()
  await page.click('.tj-consent input')
  await page.screenshot({ path: `${OUT}/3-filled.png`, fullPage: true })
  await page.click('.tj-actions button[type=submit]')
  await page.waitForSelector('#tj-code', { timeout: 90000 })
  check('registration accepted, OTP step shown (SMS sent to the owner)', true)
  await page.screenshot({ path: `${OUT}/4-otp.png` })
  state({ otpRequestedAt: new Date().toISOString(), waitingFor: CODE_FILE })
  console.log(`\n>>> waiting for the 6-digit code in ${CODE_FILE} (or a signature from the phone) …`)

  // ── Wait: the code file, or the phone finishing it ─────────────────────
  const deadline = Date.now() + Number(process.env.WAIT_MS ?? 270_000)
  let code = ''
  let signedElsewhere = false
  while (Date.now() < deadline) {
    if (existsSync(CODE_FILE)) {
      const c = readFileSync(CODE_FILE, 'utf8').replace(/\D/g, '')
      if (/^\d{6}$/.test(c)) {
        code = c
        break
      }
    }
    const [a] = await sql`select a.status from agreements a join companies c on c.id = a.company_id where c.tax_id = ${taxId} order by a.created_at desc limit 1`
    if (a?.status === 'signed') {
      signedElsewhere = true
      break
    }
    await wait(3000)
  }
  if (!code && !signedElsewhere) {
    state({ result: 'timeout waiting for code' })
    throw new Error('no code arrived within the OTP lifetime; rerun the smoke test')
  }

  let token = ''
  if (code) {
    await page.focus('#tj-code')
    await page.type('#tj-code', code)
    await page.click('.tj-otp .tj-primary').catch(() => null)
    await page.waitForFunction(() => window.location.pathname.startsWith('/tourism-2026/thanks/'), { timeout: 120000 })
    check('thank-you page reached after the real OTP', true, page.url())
    await page.screenshot({ path: `${OUT}/5-thanks.png`, fullPage: true })
    token = page.url().split('/').pop()!
    const downloadHref = await page.$eval('a.tj-primary', (a) => (a as HTMLAnchorElement).href)
    const hop = await fetch(downloadHref, { redirect: 'manual' })
    const location = hop.headers.get('location')
    check('secure download redirects to a signed storage URL', hop.status === 302 && Boolean(location), `${hop.status}`)
    const file = location ? await fetch(location) : hop
    const bytes = Buffer.from(await file.arrayBuffer())
    check('download answers 200 with a PDF', file.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-', String(file.status))
    writeFileSync(`${OUT}/signed.pdf`, bytes)
    const text = await extractPdfText(bytes)
    check('signed PDF carries the business name', text.includes(BUSINESS.split(' ')[0]))
    check('signed PDF carries the tax id', text.includes(taxId))
    check('signed PDF carries the phone', text.includes(`${PHONE.slice(0, 3)}-${PHONE.slice(3)}`))
    check('signed PDF carries the email', text.includes(EMAIL))
    check('signed PDF keeps the legal copy', text.includes('XTRA25'))
    check('signed PDF has no "save and email" instruction', !text.includes('tour@xtra.co.il'))
  } else {
    // Signed from the phone: tokens are stored hashed, so the download is not
    // fetched here; the database checks below cover the outcome.
    check('signed from the phone (seen in the database)', true)
  }
  await browser.close()

  // ── Database ───────────────────────────────────────────────────────────
  const [supplier] = await sql`select id from companies where tax_id = ${taxId} and deleted_at is null`
  check('supplier created', Boolean(supplier))
  const agreements = await sql`select id, status from agreements where company_id = ${supplier?.id ?? '00000000-0000-0000-0000-000000000000'}`
  check('one agreement, signed', agreements.length === 1 && agreements[0].status === 'signed', JSON.stringify(agreements))
  const agreementId = agreements[0]?.id ?? '00000000-0000-0000-0000-000000000000'
  const [registration] = await sql`select status, meta from project_leads where data->>'taxId' = ${taxId}`
  check('registration converted with utm', registration?.status === 'converted' && registration?.meta?.utm_source === 'smoke', JSON.stringify(registration))
  const [company] = await sql`select source, crm_record_id from companies where id = ${supplier?.id ?? '00000000-0000-0000-0000-000000000000'}`
  check('supplier is an XTRA Sign company, not linked to the CRM', company?.source === 'xtra' && company?.crm_record_id === null, JSON.stringify(company))
  const crmWrites = await sql`select count(*)::int as n from admin_audit_events where type ilike '%crm%' and created_at > now() - interval '1 hour'`
  check('no CRM writes during the test', (crmWrites[0]?.n ?? 0) === 0)
  const audit = (await sql`select type from audit_events where agreement_id = ${agreementId} order by created_at`).map((a) => a.type)
  check('audit: sent, otp_sent, otp_verified, signature_applied, completed', ['sent', 'otp_sent', 'otp_verified', 'signature_applied', 'completed'].every((t) => audit.includes(t)), audit.join(','))
  const mails = await sql`select event, channel, recipient, ok, error from message_sends where agreement_id = ${agreementId} order by sent_at`
  check('signer confirmation email sent (snapshot ok)', mails.some((m) => m.event === 'signed_confirmation' && m.ok), JSON.stringify(mails))
  const notes = await sql`select type from notifications where agreement_id = ${agreementId} or (type = 'new_lead' and body like ${'%' + BUSINESS.split(' ')[0] + '%'})`
  check('team notifications recorded (new registration + signed)', notes.some((n) => n.type === 'new_lead') && notes.some((n) => n.type === 'signed'), notes.map((n) => n.type).join(','))
  const events = await sql`select count(*)::int as n from campaign_events e join groups g on g.id = e.group_id where g.name = 'חודש התיירות הישראלית 2026' and e.created_at > now() - interval '30 minutes'`
  check('campaign events recorded for the visit', (events[0]?.n ?? 0) > 0, String(events[0]?.n))
  state({ result: failures === 0 ? 'ALL GREEN' : `${failures} FAILED`, agreementId, supplierId: supplier?.id, token })
  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILED`)
  await sql.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  state({ result: `error: ${String(error)}` })
  await sql.end()
  process.exit(1)
})
