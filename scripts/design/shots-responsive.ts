import puppeteer from 'puppeteer-core'

/**
 * Full-page screenshots of a campaign page at every width that matters,
 * with objective checks: no horizontal scroll, no element past the viewport
 * edge, and no two text-bearing elements overlapping each other.
 *
 *   SHOT_PATH=/tourism-2026/join npx tsx scripts/design/shots-responsive.ts
 */

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3057'
const PATH = process.env.SHOT_PATH ?? '/tourism-2026'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'
const WIDTHS = (process.env.SHOT_WIDTHS ?? '320,375,390,430,768,1024,1280,1440,1920').split(',').map(Number)
const SLUG = (process.env.SHOT_SLUG ?? PATH).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

type Report = { vw: number; scrollWidth: number; height: number; overflow: string[]; overlaps: string[]; overlapCount: number }

const REPORT_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth
  const leafTags = ['INPUT', 'BUTTON', 'IMG', 'CANVAS', 'TEXTAREA', 'SELECT']
  const boxes = []
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement)) continue
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    if (el.closest('.tj-honeypot, .tj-confetti, nextjs-portal')) continue
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)
    if (!own && !leafTags.includes(el.tagName)) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) continue
    boxes.push({ el, tag: el.tagName.toLowerCase(), cls: String(el.className || '').split(' ')[0], text: (el.textContent || '').trim().slice(0, 30), left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY })
  }
  const overflow = boxes.filter((b) => b.right > vw + 1 || b.left < -1).map((b) => b.tag + '.' + b.cls + ' "' + b.text + '" x' + Math.round(b.left) + '–' + Math.round(b.right))
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      if (a.el.closest('.tl-float, .tl-stage-band, .tl-band') || b.el.closest('.tl-float, .tl-stage-band, .tl-band')) continue
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 3 && h > 3) overlaps.push(a.tag + '.' + a.cls + ' "' + a.text + '" ↔ ' + b.tag + '.' + b.cls + ' "' + b.text + '" (' + Math.round(w) + '×' + Math.round(h) + ')')
    }
  }
  return { vw, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, overflow, overlaps: overlaps.slice(0, 12), overlapCount: overlaps.length }
})()`

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  let problems = 0
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${BASE}${PATH}`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    await new Promise((r) => setTimeout(r, 300))
    await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())

    // Plain JS handed to the browser as a string: tsx's function-name helper
    // (__name) does not exist inside the page, so a serialised TS closure
    // would throw there.
    const report = (await page.evaluate(REPORT_SCRIPT)) as Report

    const hscroll = report.scrollWidth > report.vw ? '  *** HORIZONTAL SCROLL ***' : ''
    console.log(`w=${width}: height=${report.height}${hscroll} overflow=${report.overflow.length} overlaps=${report.overlapCount}`)
    for (const o of report.overflow.slice(0, 6)) console.log(`    overflow: ${o}`)
    for (const o of report.overlaps) console.log(`    overlap: ${o}`)
    if (hscroll || report.overflow.length || report.overlapCount) problems++
    await page.screenshot({ path: `${OUT}/resp-${SLUG}-${width}.png`, fullPage: true })
  }
  await browser.close()
  console.log(problems === 0 ? 'LAYOUT OK at every width' : `${problems} width(s) with layout problems`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
