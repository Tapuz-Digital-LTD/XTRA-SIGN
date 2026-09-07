import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * Screenshots for the UX copy pass, phone and desktop, and a check that no
 * screen scrolls sideways.
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/ux-copy-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/ux-copy'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const PAGES: [string, string][] = [
  ['home', '/'],
  ['suppliers-gate', '/suppliers'],
  ['suppliers-xtra', '/suppliers?source=xtra'],
  ['projects', '/projects'],
  ['templates', '/templates'],
  ['agreements-attention', '/agreements?filter=attention'],
  ['tracking', '/tracking'],
  ['campaign-wizard-step1', '/projects?new=1'],
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  const overflow: string[] = []
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: width < 600 ? 844 : 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      const shot = async (name: string) => {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
        if (wide) overflow.push(`${name}@${width}`)
        // Viewport only: fullPage clips RTL pages, and the intros all sit above the fold.
        await page.screenshot({ path: `${OUT}/${name}-${width}.png` })
        console.log(`${name}-${width}.png${wide ? ' OVERFLOW' : ''}`)
      }
      for (const [name, path] of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90000 })
        await shot(name)
      }
      // The quick-send dialog opens from the home page's big button.
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 90000 })
      const launcher = await page.$$('button')
      for (const b of launcher) {
        const text = await b.evaluate((el) => el.textContent ?? '')
        if (text.includes('שלח מסמך לחתימה')) {
          await b.click()
          break
        }
      }
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
      await shot('quick-send')
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (overflow.length) throw new Error(`horizontal overflow: ${overflow.join(', ')}`)
  console.log('no horizontal overflow')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
