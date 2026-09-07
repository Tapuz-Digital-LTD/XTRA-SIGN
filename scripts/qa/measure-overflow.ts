import puppeteer from 'puppeteer-core'

/**
 * Names the elements that stick out of the viewport on a page — the quickest
 * way to find what makes a phone scroll sideways.
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 WIDTH=390 PATH_TO=/projects OPEN_WIZARD=1 npx tsx scripts/qa/measure-overflow.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const WIDTH = Number(process.env.WIDTH ?? 390)
const PATH_TO = process.env.PATH_TO ?? '/'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: 900 })
  if (SESSION) await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
  await page.goto(`${BASE}${PATH_TO}`, { waitUntil: 'networkidle0', timeout: 90000 })
  if (process.env.OPEN_WIZARD) {
    for (const b of await page.$$('main button')) {
      if ((await b.evaluate((el) => el.textContent?.trim())) === '+ קמפיין חדש') {
        await b.click()
        break
      }
    }
    await page.waitForSelector('[role="dialog"]')
  }
  const out = await page.evaluate(() => {
    const w = document.documentElement.clientWidth
    const bad: string[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > w + 1 || r.left < -1)) bad.push(`${el.tagName}.${String(el.className || '').slice(0, 70)} left=${Math.round(r.left)} right=${Math.round(r.right)}`)
    }
    return { w, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 15) }
  })
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
