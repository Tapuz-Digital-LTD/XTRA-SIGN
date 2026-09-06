import postgres from 'postgres'
import puppeteer from 'puppeteer-core'

/**
 * Sets a deployment up the way a person would: log in as the admin, open the
 * project's settings, upload the Ministry PDF as the agreement template,
 * switch self-service on. Used where the setup script cannot reach the Blob
 * store from a laptop (OIDC is deployment-bound) — the deployment itself can.
 *
 * Needs log-only notifications on the deployment (the login code is shown on
 * the page) and, for a protected preview, a share link.
 *
 *   E2E_BASE=https://… E2E_SHARE_URL=https://…?_vercel_share=… E2E_DB=postgres://… \
 *     npx tsx scripts/qa/preview-setup-ui.ts
 */

const BASE = process.env.E2E_BASE!
const DB = process.env.E2E_DB!
const SHARE = process.env.E2E_SHARE_URL ?? ''
const PDF = '.design/tourism-2026/agreement.pdf'
const PROJECT_NAME = 'חודש התיירות הישראלית 2026'
const TEMPLATE_NAME = 'הסכם השתתפות — חודש התיירות הישראלית 2026'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'

const sql = postgres(DB, { max: 1 })

async function main() {
  const [admin] = await sql`select email, phone from users where is_admin and disabled_at is null order by created_at limit 1`
  const [project] = await sql`select id from groups where name = ${PROJECT_NAME} and deleted_at is null limit 1`
  if (!admin || !project) throw new Error('admin or project missing on the target database')
  const phone = String(admin.phone).replace('+972', '0')

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) console.log(`  ↳ ${r.request().method()} ${r.url().replace(BASE, '')} ${r.status()}`)
  })

  if (SHARE) await page.goto(SHARE, { waitUntil: 'networkidle0', timeout: 60000 })

  // ── Login with the code the page shows in log-only mode ────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.type('#phone', phone)
  await page.keyboard.press('Enter')
  await page.waitForSelector('#code', { timeout: 30000 })
  const devCode = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((s) => /^\d{6}$/.test(s.textContent?.trim() ?? ''))
    return el?.textContent?.trim() ?? ''
  })
  if (!/^\d{6}$/.test(devCode)) throw new Error('no dev code on the login page — is SIGN_LOG_NOTIFICATIONS=true on the deployment?')
  await page.type('#code', devCode)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  console.log(`logged in as ${admin.email}`)

  // ── Project settings → upload the agreement, switch self-service on ────
  await page.goto(`${BASE}/projects/${project.id}?tab=settings`, { waitUntil: 'networkidle0', timeout: 60000 })
  const alreadyOn = await page.evaluate(() => {
    const url = [...document.querySelectorAll('span[dir=ltr]')].find((s) => s.textContent?.includes('/tourism-2026'))
    return Boolean(url)
  })
  if (alreadyOn) {
    console.log('self-service already on')
  } else {
    const nameInput = await page.$('input[placeholder="שם התבנית"]')
    await nameInput!.type(TEMPLATE_NAME)
    const fileInput = await page.$('input[type=file][accept="application/pdf"]')
    await fileInput!.uploadFile(PDF)
    const uploadButton = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'העלאה'))
    await (uploadButton.asElement() as import('puppeteer-core').ElementHandle<Element>).click()
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('ההסכם הועלה'), { timeout: 60000 })
    console.log('template uploaded:', await page.$eval('[role=status]', (el) => el.textContent))

    // The section's own toggle and save button.
    const toggle = await page.$('section input[type=checkbox]:not(:disabled)')
    const checked = await page.evaluate((el) => (el as HTMLInputElement).checked, toggle!)
    if (!checked) await toggle!.click()
    const saveButton = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'שמירת ההרשמה העצמאית'))
    await (saveButton.asElement() as import('puppeteer-core').ElementHandle<Element>).click()
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('פעילה'), { timeout: 30000 })
    console.log('self-service:', await page.$eval('[role=status]', (el) => el.textContent))
  }
  await page.screenshot({ path: `${OUT}/preview-settings.png`, fullPage: true })

  // ── The public door answers ────────────────────────────────────────────
  await page.goto(`${BASE}/tourism-2026/join`, { waitUntil: 'networkidle0', timeout: 60000 })
  const formUp = await page.$('#tj-businessName')
  console.log(formUp ? 'public joining page is live' : 'public joining page NOT live')
  await browser.close()

  const config = await sql`select landing_config->'selfService' as ss from groups where id = ${project.id}`
  console.log('config:', JSON.stringify(config[0].ss))
  await sql.end()
  process.exit(formUp ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await sql.end()
  process.exit(1)
})
