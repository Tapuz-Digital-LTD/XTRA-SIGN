import puppeteer, { type Page } from 'puppeteer-core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * A new worker's first day, as a browser: open a campaign, send an
 * invitation, look at a registration, open the supplier, come back to the
 * same place, send a reminder, open a signed agreement. Every step asserts
 * what a person would see. Sends go through the local (logging) provider.
 *
 *   SESSION=<token> [PROJECT=<id>] npx dotenv -e .env.local -- npx tsx scripts/qa/new-worker-flow.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/new-worker'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const results: string[] = []
let failed = 0
function check(ok: boolean, label: string, detail?: string) {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function projectId(): Promise<string> {
  if (process.env.PROJECT) return process.env.PROJECT
  const [g] = await getDb().select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no self-service campaign in the local DB')
  return g.id
}

const clickText = async (page: Page, text: string, scope = '') => {
  const [el] = await page.$$(`xpath/.${scope}//*[self::button or self::a][contains(normalize-space(.), "${text}")]`)
  if (!el) throw new Error(`no element with text "${text}"`)
  await el.evaluate((e) => (e as HTMLElement).click())
}
const settle = (page: Page, ms = 800) => new Promise((r) => setTimeout(r, ms)).then(() => page.waitForNetworkIdle({ idleTime: 300, timeout: 20000 }).catch(() => null))

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const id = await projectId()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    // 1. Open the campaign from the list.
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.goto(`${BASE}/projects/${id}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const tabs = await page.$$eval('nav[aria-label="לשוניות הפרויקט"] a', (as) => as.map((a) => a.textContent?.trim()))
    check(tabs.join('|').includes('הזמנות ומעקב') && tabs.join('|').includes('הרשמות'), '1. campaign opens with the agreed tabs', tabs.join(' | '))

    // 2. Send an invitation by SMS.
    await page.goto(`${BASE}/projects/${id}?tab=invitations`, { waitUntil: 'networkidle0', timeout: 90000 })
    await clickText(page, 'שליחת הזמנה')
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const stamp = Date.now()
    await page.type('[role="dialog"] input[maxlength="120"]', `בדיקה עובד חדש ${stamp}`)
    await page.type('[role="dialog"] input[inputmode="tel"]', '0500000321')
    const kindRadio = await page.$('[role="dialog"] input[name="inv-kind"]')
    if (kindRadio) await kindRadio.evaluate((el) => (el.parentElement as HTMLElement).click())
    const sendLabel = await page.$eval('[role="dialog"] form button[type="submit"]', (b) => b.textContent?.trim())
    check(sendLabel === 'שלח הזמנה ב-SMS', '2a. the action button names the channel', sendLabel)
    await page.click('[role="dialog"] form button[type="submit"]')
    await page.waitForFunction(() => /ההזמנה נשלחה|ההזמנה נשמרה/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), { timeout: 30000 })
    await page.screenshot({ path: `${OUT}/2-invitation-sent.png` })
    await page.keyboard.press('Escape')
    await page.goto(`${BASE}/projects/${id}?tab=invitations&q=${encodeURIComponent(String(stamp))}`, { waitUntil: 'networkidle0', timeout: 90000 })
    const invited = await page.$$eval('tbody tr', (trs) => trs.map((t) => t.textContent ?? ''))
    check(invited.some((t) => t.includes('הוזמן')), '2b. the person appears in הזמנות ומעקב as הוזמן', invited[0]?.slice(0, 80))

    // 3. Look at a registration and open its supplier.
    await page.goto(`${BASE}/projects/${id}?tab=registrations`, { waitUntil: 'networkidle0', timeout: 90000 })
    const hasRows = (await page.$$('tbody tr')).length > 0
    check(hasRows, '3a. registrations are listed at once (no lead views to open)')
    await page.screenshot({ path: `${OUT}/3-registrations.png` })
    const supplierLink = await page.$('a[href^="/companies/"]')
    if (supplierLink) {
      const before = page.url()
      await supplierLink.evaluate((a) => (a as HTMLElement).click())
      await settle(page)
      check(page.url().includes('/companies/'), '3b. supplier card opens from the registrations tab', page.url())
      const back = await page.$('[data-back-link]')
      check(Boolean(back), '3c. the card shows a back link')
      if (back) {
        await back.evaluate((a) => (a as HTMLElement).click())
        await settle(page)
        check(page.url() === before, '3d. חזרה returns to the same campaign tab', page.url())
      }
    } else {
      // Rows open a drawer; the company link lives inside it. Not every
      // registration has a company (a failed one does not), so try a few.
      let drawerLink = null
      for (const row of (await page.$$('tbody tr')).slice(0, 6)) {
        await row.evaluate((tr) => (tr as HTMLElement).click())
        await page.waitForFunction(() => /פרטי העסק|טוען/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), { timeout: 8000 }).catch(() => null)
        await page.waitForFunction(() => !/טוען…/.test(document.querySelector('[role="dialog"]')?.textContent ?? ''), { timeout: 8000 }).catch(() => null)
        drawerLink = await page.$('[role="dialog"] a[href^="/companies/"]')
        if (drawerLink) break
        await page.keyboard.press('Escape')
        await settle(page, 300)
      }
      check(Boolean(drawerLink), '3b. the registration drawer links to the supplier')
      if (drawerLink) {
        const before = page.url()
        await drawerLink.evaluate((a) => (a as HTMLElement).click())
        await settle(page)
        check(page.url().includes('/companies/'), '3c. supplier card opens', page.url())
        const back = await page.$('[data-back-link]')
        if (back) {
          await back.evaluate((a) => (a as HTMLElement).click())
          await settle(page)
          check(page.url().startsWith(before.split('#')[0]), '3d. חזרה returns to the campaign', page.url())
        } else check(false, '3d. back link missing on the card')
      }
    }

    // 4. Send a reminder from the tracking tab (a person waiting for a signature).
    await page.goto(`${BASE}/projects/${id}?tab=invitations&view=waiting`, { waitUntil: 'networkidle0', timeout: 90000 })
    const waitingRow = await page.$('tbody tr')
    if (waitingRow) {
      await waitingRow.evaluate((tr) => (tr as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      const buttons = await page.$$eval('[role="dialog"] button', (bs) => bs.map((b) => b.textContent?.trim() ?? ''))
      const reminder = buttons.find((b) => b.includes('תזכורת') || b.includes('שלח שוב'))
      check(Boolean(reminder), '4a. the drawer offers a reminder / resend', buttons.filter((b) => b).slice(0, 8).join(' | '))
      if (reminder) {
        await clickText(page, reminder, '//div[@role="dialog"]')
        await settle(page, 1500)
        const notice = await page.$eval('[role="status"], [role="alert"]', (el) => el.textContent?.trim() ?? '').catch(() => '')
        check(notice.length > 0, '4b. the result is shown in words', notice.slice(0, 120))
        await page.screenshot({ path: `${OUT}/4-reminder.png` })
      }
      await page.keyboard.press('Escape')
    } else check(false, '4. no one waiting for a signature in this campaign')

    // 5. Open a signed agreement.
    await page.goto(`${BASE}/projects/${id}?tab=invitations&view=signed`, { waitUntil: 'networkidle0', timeout: 90000 })
    const signedRow = await page.$('tbody tr')
    if (signedRow) {
      await signedRow.evaluate((tr) => (tr as HTMLElement).click())
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      const open = await page.$('[role="dialog"] a[href^="/documents/"]')
      check(Boolean(open), '5a. a signed person offers "פתח הסכם"')
      if (open) {
        await open.evaluate((a) => (a as HTMLElement).click())
        await settle(page)
        const text = await page.evaluate(() => document.body.textContent ?? '')
        check(page.url().includes('/documents/') && text.includes('נחתם'), '5b. the agreement page shows the signed state', page.url())
        await page.screenshot({ path: `${OUT}/5-signed-agreement.png` })
        const back = await page.$('[data-back-link]')
        if (back) {
          await back.evaluate((a) => (a as HTMLElement).click())
          await settle(page)
          check(page.url().includes('tab=invitations'), '5c. חזרה returns to הזמנות ומעקב', page.url())
        }
      }
    } else check(false, '5. no signed person in this campaign')
  } finally {
    await browser.close()
  }
  console.log(results.join('\n'))
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`NEW WORKER FLOW OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  console.log(results.join('\n'))
  process.exit(1)
})
