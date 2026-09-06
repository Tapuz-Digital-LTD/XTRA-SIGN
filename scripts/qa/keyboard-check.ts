import puppeteer from 'puppeteer-core'

/**
 * A phone with the keyboard open is a phone with half a screen. This focuses
 * each input of the joining page in a 390×844 viewport, then shrinks the
 * viewport to 390×430 (what a soft keyboard leaves) and checks the focused
 * control is still fully visible — the browser scrolls it into view, and the
 * page's scroll padding keeps it clear of anything at the bottom.
 *
 *   E2E_BASE=http://localhost:3057 npx tsx scripts/qa/keyboard-check.ts
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'
const WIDTH = 390
const FULL = 844
const WITH_KEYBOARD = 430

async function main() {
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

  await page.setViewport({ width: WIDTH, height: FULL, deviceScaleFactor: 2 })
  await page.goto(`${BASE}/tourism-2026/join`, { waitUntil: 'networkidle0', timeout: 60000 })

  for (const id of ['tj-businessName', 'tj-taxId', 'tj-phone', 'tj-email', 'tj-signatoryName', 'tj-signatoryRole']) {
    await page.setViewport({ width: WIDTH, height: FULL, deviceScaleFactor: 2 })
    await page.focus(`#${id}`)
    await page.setViewport({ width: WIDTH, height: WITH_KEYBOARD, deviceScaleFactor: 2 })
    await page.evaluate((sel) => document.getElementById(sel)?.scrollIntoView({ block: 'nearest' }), id)
    await new Promise((r) => setTimeout(r, 200))
    const box = await page.evaluate((sel) => {
      const el = document.getElementById(sel)!
      const r = el.getBoundingClientRect()
      const label = document.querySelector(`label[for="${sel}"]`)?.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, labelTop: label?.top ?? r.top, vh: innerHeight }
    }, id)
    check(`${id} visible with the keyboard open`, box.top >= 0 && box.bottom <= box.vh, `top ${Math.round(box.top)} bottom ${Math.round(box.bottom)} of ${box.vh}`)
    if (id === 'tj-phone') await page.screenshot({ path: `${OUT}/keyboard-phone.png` })
  }

  // The signature pad with the keyboard closed again: it must fit a phone
  // screen with its clear button and the consent line.
  await page.setViewport({ width: WIDTH, height: FULL, deviceScaleFactor: 2 })
  await page.evaluate(() => document.querySelector('.tj-pad-frame')?.scrollIntoView({ block: 'start' }))
  await new Promise((r) => setTimeout(r, 200))
  const pad = await page.evaluate(() => {
    const frame = document.querySelector('.tj-pad-frame')!.getBoundingClientRect()
    const clear = document.querySelector('.tj-pad-clear')!.getBoundingClientRect()
    const consent = document.querySelector('.tj-consent')!.getBoundingClientRect()
    return { padHeight: frame.height, clearBottom: clear.bottom, consentBottom: consent.bottom, vh: innerHeight }
  })
  check('signature pad is tall enough for a finger', pad.padHeight >= 180, `${Math.round(pad.padHeight)}px`)
  check('pad, clear and consent fit one phone screen', pad.consentBottom <= pad.vh, `consent bottom ${Math.round(pad.consentBottom)} of ${pad.vh}`)
  await page.screenshot({ path: `${OUT}/keyboard-pad.png` })

  await browser.close()
  console.log(failures === 0 ? 'KEYBOARD OK' : `${failures} problem(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
