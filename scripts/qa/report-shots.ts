import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * Screenshots of a project's reports tab at phone and desktop widths, plus
 * the two checks that matter on a phone: no horizontal page scroll, nothing
 * wider than the viewport.
 *
 *   SESSION=<raw token from scripts/dev-session.ts> PROJECT=<id> \
 *   E2E_BASE=http://localhost:3057 npx tsx scripts/qa/report-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const PROJECT = process.env.PROJECT ?? ''
const OUT = process.env.OUT ?? '.design/qa/report'
const WIDTHS = (process.env.WIDTHS ?? '375,390,430,768,1440').split(',').map(Number)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!SESSION || !PROJECT) throw new Error('SESSION and PROJECT are required')
mkdirSync(OUT, { recursive: true })

const CHECK = `(() => {
  const vw = document.documentElement.clientWidth
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || el.closest('[aria-hidden="true"], [hidden]')) continue
      let p = el.parentElement, clipped = false
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clipped = true; break } p = p.parentElement }
      if (!clipped && style.position !== 'fixed') wide.push(el.tagName + '.' + String(el.className).split(' ')[0] + ' L' + Math.round(r.left) + ' R' + Math.round(r.right) + ' ' + (el.textContent || '').trim().slice(0, 20))
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 8) }
})()`

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      await page.goto(`${BASE}/projects/${PROJECT}?tab=reports&range=30d`, { waitUntil: 'networkidle0', timeout: 90000 })
      await new Promise((r) => setTimeout(r, 1500))
      const result = (await page.evaluate(CHECK)) as { scrollWidth: number; vw: number; wide: string[] }
      const ok = result.scrollWidth <= result.vw + 1 && result.wide.length === 0
      if (!ok) failures++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${width}px  scrollWidth=${result.scrollWidth} vw=${result.vw} ${result.wide.join(' | ')}`)
      await page.screenshot({ path: `${OUT}/report-${width}.png`, fullPage: true })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'REPORT SHOTS OK' : `${failures} widths failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
