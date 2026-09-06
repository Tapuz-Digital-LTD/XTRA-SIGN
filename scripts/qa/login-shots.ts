import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * Login → code → in, photographed at phone, tablet and desktop widths, plus
 * a phone with the keyboard open (a short viewport). Checks: no sideways
 * scroll, the primary button inside the viewport with the keyboard up, and
 * the whole flow completing with the dev code the server shows in log-only
 * mode.
 *
 *   PHONE=05xxxxxxxx E2E_BASE=http://localhost:3057 npx tsx scripts/qa/login-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const PHONE = process.env.PHONE ?? ''
const OUT = process.env.OUT ?? '.design/qa/login'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!PHONE) throw new Error('PHONE required (a user in the local database)')
mkdirSync(OUT, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  }
  try {
    for (const width of [375, 390, 430, 768, 1024, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.screenshot({ path: `${OUT}/login-${width}.png` })
      const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }))
      check(`login ${width}: no horizontal scroll`, scroll.sw <= scroll.vw + 1, `${scroll.sw}/${scroll.vw}`)
      await page.close()
    }

    // The flow, on a phone — and with the keyboard "open" (a short viewport).
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.type('#phone', PHONE)
    await page.setViewport({ width: 390, height: 420 })
    const cta = await page.$('button[type="submit"]')
    const box = await cta!.boundingBox()
    check('phone step: CTA visible with keyboard open', Boolean(box && box.y + box.height <= 420), `bottom=${box ? Math.round(box.y + box.height) : '?'}`)
    await page.screenshot({ path: `${OUT}/flow-1-phone-keyboard.png` })
    await page.setViewport({ width: 390, height: 844 })
    await cta!.click()
    await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('הזינו את הקוד'), { timeout: 30000 })
    await page.screenshot({ path: `${OUT}/flow-2-code.png` })
    const devCode = await page.evaluate(() => document.querySelector('[role="status"] span[dir="ltr"]')?.textContent?.trim() ?? '')
    check('code step: dev code shown (log-only)', /^\d{6}$/.test(devCode), devCode)
    // Keyboard open on the code step: the boxes and the button must both fit.
    await page.setViewport({ width: 390, height: 420 })
    const otpBox = await (await page.$('input[autocomplete="one-time-code"]'))!.boundingBox()
    check('code step: input reachable with keyboard open', Boolean(otpBox && otpBox.y >= 0), `y=${otpBox ? Math.round(otpBox.y) : '?'}`)
    await page.screenshot({ path: `${OUT}/flow-2-code-keyboard.png` })
    await page.setViewport({ width: 390, height: 844 })
    // Paste the whole code at once — the way a person does from Messages.
    await page.click('input[autocomplete="one-time-code"]')
    await page.keyboard.sendCharacter(devCode)
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('נכנסתם בהצלחה'), { timeout: 30000 })
    await page.screenshot({ path: `${OUT}/flow-3-success.png` })
    await page.waitForFunction(() => location.pathname !== '/login', { timeout: 30000 })
    check('signed in and redirected', page.url().includes('/documents'), page.url())
    await page.close()
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'LOGIN SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
