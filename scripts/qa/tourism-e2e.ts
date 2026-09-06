import postgres from 'postgres'
import puppeteer from 'puppeteer-core'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'

/**
 * The whole public journey in a real browser against a server with log-only
 * notifications: Page 1 → join → sign with the pointer → the code shown by
 * the dev panel → thank-you → download, then the database.
 *
 *   E2E_BASE=http://localhost:3057 E2E_DB=postgres://xtra:xtra@localhost:5433/xtra_sign \
 *     npx tsx scripts/qa/tourism-e2e.ts
 *
 * Against a protected Vercel preview, pass E2E_SHARE_URL (a share link that
 * sets the access cookie) and E2E_DB pointing at the preview database.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const DB = process.env.E2E_DB ?? 'postgres://xtra:xtra@localhost:5433/xtra_sign'
const SHARE = process.env.E2E_SHARE_URL ?? ''
const WIDTH = Number(process.env.E2E_WIDTH ?? 390)
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'

const sql = postgres(DB, { max: 1 })

let failures = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function main() {
  const stamp = Date.now()
  const business = `E2E מלון הבדיקה ${stamp}`
  const taxId = String(510000000 + (stamp % 9000000))
  const phone = `052${String(1000000 + (stamp % 8999999))}`

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`  ↳ ${r.request().method()} ${r.url().replace(BASE, '')} ${r.status()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) console.log('  browser:', m.text())
  })
  // Pointer input is driven through the mouse API, so no touch emulation: the
  // pad listens to pointer events either way.
  await page.setViewport({ width: WIDTH, height: 844, deviceScaleFactor: 2 })

  if (SHARE) {
    // A protected preview: the share link sets the access cookie for this browser.
    await page.goto(SHARE, { waitUntil: 'networkidle0', timeout: 60000 })
    check('share link opened the protected preview', page.url().startsWith(BASE), page.url())
  }

  // ── Page 1 → Page 2 ────────────────────────────────────────────────────
  await page.goto(`${BASE}/tourism-2026?utm_source=e2e&utm_campaign=local`, { waitUntil: 'networkidle0', timeout: 60000 })
  const ctaHref = await page.$eval('a.tl-cta', (a) => (a as HTMLAnchorElement).getAttribute('href'))
  check('Page 1 CTA carries the campaign query to the joining page', ctaHref === '/tourism-2026/join?utm_source=e2e&utm_campaign=local', String(ctaHref))
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), page.click('a.tl-cta')])
  check('landed on /tourism-2026/join', page.url().includes('/tourism-2026/join'), page.url())

  // ── Details ────────────────────────────────────────────────────────────
  await page.type('#tj-businessName', business)
  await page.type('#tj-taxId', taxId.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3'))
  await page.type('#tj-phone', `${phone.slice(0, 3)}-${phone.slice(3)}`)
  await page.type('#tj-email', `e2e-${stamp}@example.com`)
  await page.type('#tj-signatoryName', 'ישראל ישראלי')
  await page.type('#tj-signatoryRole', 'מנכ"ל')

  // ── Submit without a signature: refused on the page, nothing sent ──────
  await page.click('.tj-sticky button[type=submit]')
  await page.waitForSelector('.tj-alert', { timeout: 5000 })
  const alertText = await page.$eval('.tj-alert', (el) => el.textContent ?? '')
  check('refuses to send without a signature', alertText.includes('לחתום'), alertText)

  // ── Signature with the pointer ─────────────────────────────────────────
  const pad = await page.$('canvas.tj-pad')
  // The page scrolls the pad into view smoothly after the refusal; the
  // pointer needs it settled inside the viewport.
  await page.evaluate(() => document.querySelector('canvas.tj-pad')?.scrollIntoView({ block: 'center' }))
  await new Promise((r) => setTimeout(r, 800))
  const box = await pad!.boundingBox()
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(box!.x + box!.width * (0.2 + i * 0.03), box!.y + box!.height * (0.6 + Math.sin(i / 2) * 0.15))
  }
  await page.mouse.up()
  const cleared = await page.$eval('.tj-pad-clear', (b) => (b as HTMLButtonElement).disabled)
  check('signature registered on the pad', cleared === false)
  await page.click('.tj-consent input')
  await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-filled.png`, fullPage: true })

  // Double click: one registration.
  await page.click('.tj-sticky button[type=submit]')
  await page.click('.tj-sticky button[type=submit]').catch(() => {})
  await page.waitForSelector('#tj-code', { timeout: 60000 })
  check('OTP panel shown', true)
  await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-otp.png`, fullPage: true })

  const devCode = await page.$eval('.tj-devcode strong', (el) => el.textContent?.trim() ?? '').catch(() => '')
  check('dev code shown (log-only mode)', /^\d{6}$/.test(devCode), devCode)

  // Wrong code first.
  await page.type('#tj-code', '000000')
  await page.click('.tj-otp .tj-primary')
  await page.waitForFunction(() => document.querySelector('.tj-otp .tj-alert')?.textContent?.includes('שגוי'), { timeout: 15000 })
  check('wrong code refused', true)
  await page.focus('#tj-code')
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  await page.type('#tj-code', devCode)
  // The thank-you page is reached by a client-side navigation, which
  // waitForNavigation does not see.
  await page.click('.tj-otp .tj-primary')
  try {
    await page.waitForFunction(() => location.pathname.startsWith('/tourism-2026/thanks/'), { timeout: 90000 })
  } catch (error) {
    await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-fail.png`, fullPage: true })
    const alert = await page.$eval('.tj-otp .tj-alert', (el) => el.textContent).catch(() => null)
    console.log('stuck at', page.url(), 'alert:', alert)
    throw error
  }
  await page.waitForSelector('a.tj-primary', { timeout: 30000 })
  check('landed on the thank-you page', /\/tourism-2026\/thanks\/[A-Za-z0-9_-]+$/.test(page.url()), page.url())
  await page.screenshot({ path: `${OUT}/e2e-${WIDTH}-thanks.png`, fullPage: true })

  const downloadHref = await page.$eval('a.tj-primary', (a) => (a as HTMLAnchorElement).href)
  const token = page.url().split('/').pop()!

  // ── Download: the same two hops a click makes — our route (with the
  // browser's cookies, so a protected preview lets us in), then the
  // short-lived storage URL it redirects to. Not fetched from inside the page:
  // the page's CSP only lets script talk to our own origin, and a click is a
  // navigation, which the CSP does not govern.
  const cookieHeader = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const hop = await fetch(downloadHref, { headers: { cookie: cookieHeader }, redirect: 'manual' })
  const location = hop.headers.get('location')
  check('download route redirects to a signed storage URL', hop.status === 302 && Boolean(location), `${hop.status} ${location ? new URL(location).host : ''}`)
  const file = location ? await fetch(location) : hop
  void file
  const downloaded = { status: file.status, bytes: Buffer.from(await file.arrayBuffer()) }
  check('download answers 200', downloaded.status === 200, String(downloaded.status))
  const bytes = downloaded.bytes
  check('download is a PDF', bytes.subarray(0, 5).toString() === '%PDF-')
  const text = await extractPdfText(bytes)
  check('signed PDF carries the tax id', text.includes(taxId))
  check('signed PDF carries the phone', text.includes(`${phone.slice(0, 3)}-${phone.slice(3)}`))
  check('signed PDF carries the email', text.includes(`e2e-${stamp}@example.com`))
  check('signed PDF keeps the legal copy', text.includes('XTRA25'))

  // ── Returning through the links after signing ──────────────────────────
  await page.goto(`${BASE}/tourism-2026/sign/${token}`, { waitUntil: 'networkidle0', timeout: 60000 })
  check('signed link lands on the thank-you page', page.url().includes('/tourism-2026/thanks/'), page.url())
  await page.goto(`${BASE}/sign/${token}`, { waitUntil: 'networkidle0', timeout: 60000 })
  check('/sign/[token] hands over to the campaign', page.url().includes('/tourism-2026/'), page.url())
  await browser.close()

  // ── Database ───────────────────────────────────────────────────────────
  const [supplier] = await sql`select id, kind, contact_phone, contact_email from companies where tax_id = ${taxId} and deleted_at is null`
  check('one supplier created', Boolean(supplier), JSON.stringify(supplier))
  const agreements = await sql`select id, status, title from agreements where company_id = ${supplier?.id ?? '00000000-0000-0000-0000-000000000000'}`
  check('exactly one agreement, signed', agreements.length === 1 && agreements[0].status === 'signed', JSON.stringify(agreements))
  const [registration] = await sql`select status, source, meta, agreement_id from project_leads where data->>'taxId' = ${taxId}`
  check('registration converted with meta', registration?.status === 'converted' && registration?.meta?.utm_source === 'e2e', JSON.stringify(registration))
  const membership = await sql`select 1 from company_groups cg join groups g on g.id = cg.group_id where cg.company_id = ${supplier?.id ?? '00000000-0000-0000-0000-000000000000'} and g.name = 'חודש התיירות הישראלית 2026'`
  check('supplier is in the project', membership.length === 1)
  const audit = await sql`select type from audit_events where agreement_id = ${agreements[0]?.id ?? '00000000-0000-0000-0000-000000000000'} order by created_at`
  const types = audit.map((a) => a.type)
  check('audit trail: sent, otp, signature, completed', ['sent', 'otp_sent', 'otp_verified', 'signature_applied', 'completed'].every((t) => types.includes(t)), types.join(','))
  const [signature] = await sql`select method from signatures s join agreement_versions v on v.id = s.agreement_version_id where v.agreement_id = ${agreements[0]?.id ?? '00000000-0000-0000-0000-000000000000'}`
  check('signature recorded as drawn', signature?.method === 'drawn')

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILED`)
  await sql.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await sql.end()
  process.exit(1)
})
