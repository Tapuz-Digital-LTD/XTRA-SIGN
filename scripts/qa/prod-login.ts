import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import puppeteer from 'puppeteer-core'

/**
 * A real login on a deployed environment, the way a person does it: the
 * phone, the SMS, the code. The code is handed over through a file (the
 * SMS lands on the owner's phone, not here); the resulting session cookie
 * is written to COOKIE_FILE for the configuration calls that follow, and
 * is never printed.
 *
 *   E2E_BASE=https://xtra-sign.vercel.app PHONE=05xxxxxxxx CODE_FILE=/path/login-code.txt COOKIE_FILE=/path/cookie.txt \
 *     npx tsx scripts/qa/prod-login.ts
 */
const BASE = process.env.E2E_BASE ?? ''
const PHONE = (process.env.PHONE ?? '').replace(/\D/g, '')
const CODE_FILE = process.env.CODE_FILE ?? ''
const COOKIE_FILE = process.env.COOKIE_FILE ?? ''
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!BASE || !PHONE || !CODE_FILE || !COOKIE_FILE) throw new Error('E2E_BASE, PHONE, CODE_FILE and COOKIE_FILE are required')
mkdirSync(dirname(COOKIE_FILE), { recursive: true })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.type('#phone', PHONE)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('הזינו את הקוד'), { timeout: 60000 })
  console.log(`>>> code requested; waiting for ${CODE_FILE} …`)
  const deadline = Date.now() + 270_000
  let code = ''
  while (Date.now() < deadline) {
    if (existsSync(CODE_FILE)) {
      const c = readFileSync(CODE_FILE, 'utf8').replace(/\D/g, '')
      if (/^\d{6}$/.test(c)) {
        code = c
        break
      }
    }
    await wait(2000)
  }
  if (!code) throw new Error('no login code arrived in time')
  await page.click('input[autocomplete="one-time-code"]')
  await page.keyboard.sendCharacter(code)
  await page.waitForFunction(() => location.pathname !== '/login', { timeout: 60000 })
  const cookie = (await page.cookies()).find((c) => c.name === 'xtra_sign_session')
  if (!cookie) throw new Error('no session cookie after login')
  writeFileSync(COOKIE_FILE, cookie.value, { mode: 0o600 })
  console.log(`logged in as the owner; session cookie saved (${cookie.value.length} chars)`)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
