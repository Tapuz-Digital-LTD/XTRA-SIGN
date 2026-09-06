import puppeteer from 'puppeteer-core'

/**
 * The joining page's rhythm, measured: the vertical gap between every pair of
 * consecutive blocks (cards and the main button) must be the same at a given
 * width, every heading must sit inside its card, and the consent checkbox
 * must line up with its text. Also viewport-sized screenshots (what a person
 * actually sees, floating button included) for the call page and the joining
 * page at each width.
 *
 *   E2E_BASE=http://localhost:3057 npx tsx scripts/qa/spacing-check.ts
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026/polish'
const WIDTHS = (process.env.SHOT_WIDTHS ?? '375,390,430,768,1440').split(',').map(Number)

const MEASURE = `(() => {
  const content = document.querySelector('.tj-content')
  const blocks = [...content.querySelectorAll('.tj-flow > .tj-card, .tj-form > .tj-card, .tj-form > .tj-actions')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.top - b.r.top)
  const gaps = []
  for (let i = 1; i < blocks.length; i++) gaps.push(Math.round(blocks[i].r.top - blocks[i - 1].r.bottom))
  const headings = [...document.querySelectorAll('.tj-card > .tj-h2')].map((h) => {
    const card = h.closest('.tj-card').getBoundingClientRect()
    const r = h.getBoundingClientRect()
    const cs = getComputedStyle(h.closest('.tj-card'))
    return { text: h.textContent.trim(), inside: r.top >= card.top + parseFloat(cs.paddingTop) - 1 && r.left >= card.left && r.right <= card.right, topPad: Math.round(r.top - card.top) }
  })
  const consent = document.querySelector('.tj-consent')
  const box = consent.querySelector('input').getBoundingClientRect()
  const text = consent.querySelector('span').getBoundingClientRect()
  const firstLine = parseFloat(getComputedStyle(consent.querySelector('span')).lineHeight)
  const button = document.querySelector('.tj-primary-main').getBoundingClientRect()
  return {
    gaps,
    headings,
    consentAligned: Math.abs((box.top + box.height / 2) - (text.top + firstLine / 2)) <= 4,
    buttonBelowSpace: Math.round(content.getBoundingClientRect().bottom - button.bottom),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`

type Measure = { gaps: number[]; headings: { text: string; inside: boolean; topPad: number }[]; consentAligned: boolean; buttonBelowSpace: number; hscroll: boolean }

async function main() {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  let failures = 0
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!ok) failures++
  }

  for (const width of WIDTHS) {
    const height = width < 860 ? 844 : 900
    await page.setViewport({ width, height, deviceScaleFactor: 2 })

    // The joining page: rhythm, headings, consent, button room.
    await page.goto(`${BASE}/tourism-2026/join`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
    const m = (await page.evaluate(MEASURE)) as Measure
    const distinct = [...new Set(m.gaps)]
    check(`join ${width}: equal gaps between all blocks`, distinct.length === 1, `gaps ${m.gaps.join(', ')}`)
    check(`join ${width}: headings inside their cards`, m.headings.every((h) => h.inside), m.headings.map((h) => `${h.text}:${h.topPad}px`).join(' '))
    check(`join ${width}: consent checkbox aligned with its first line`, m.consentAligned)
    check(`join ${width}: room under the main button`, m.buttonBelowSpace >= 24, `${m.buttonBelowSpace}px`)
    check(`join ${width}: no horizontal scroll`, !m.hscroll)
    await page.screenshot({ path: `${OUT}/join-${width}-top.png` })
    await page.evaluate(() => document.querySelector('.tj-primary-main')?.scrollIntoView({ block: 'center' }))
    await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}/join-${width}-cta.png` })
    await page.evaluate(() => document.getElementById('tj-signatory-heading')?.scrollIntoView({ block: 'start' }))
    await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}/join-${width}-sections.png` })

    // The call page: the floating button as seen, and its disappearance.
    await page.goto(`${BASE}/tourism-2026`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
    await new Promise((r) => setTimeout(r, 500))
    const floatTop = await page.$eval('.tl-float', (el) => {
      const r = el.getBoundingClientRect()
      return { visible: getComputedStyle(el).opacity !== '0', bottomGap: Math.round(innerHeight - r.bottom), height: Math.round(r.height), inside: r.right <= innerWidth && r.left >= 0 }
    })
    check(`call ${width}: floating CTA visible at the top, ${floatTop.height}px tall, ${floatTop.bottomGap}px from the bottom`, floatTop.visible && floatTop.inside && floatTop.bottomGap >= 20)
    await page.screenshot({ path: `${OUT}/call-${width}-top.png` })
    await page.evaluate(() => document.querySelector('.tl-cta')?.scrollIntoView({ block: 'center' }))
    await new Promise((r) => setTimeout(r, 700))
    const floatHidden = await page.$eval('.tl-float', (el) => getComputedStyle(el).opacity === '0')
    check(`call ${width}: floating CTA hides when the signpost is on screen`, floatHidden)
    await page.screenshot({ path: `${OUT}/call-${width}-signpost.png` })
  }

  await browser.close()
  console.log(failures === 0 ? 'POLISH OK' : `${failures} problem(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
