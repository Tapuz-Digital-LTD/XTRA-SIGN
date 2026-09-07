import { readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * The share image for the Ministry of Tourism campaign: a 1200×630
 * composition of the campaign's own assets (headline, character, logo) on
 * its own colours — the same look as the landing page, laid out for a
 * horizontal preview card. Nothing invented: no new logos, no new text.
 *
 *   npx tsx scripts/design/tourism-og.ts   → public/tourism-2026/og.png
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const asset = (name: string) => `data:image/webp;base64,${readFileSync(`public/tourism-2026/${name}`).toString('base64')}`

const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;700;900&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;font-family:Heebo,Arial,sans-serif}
  .stage{position:relative;width:1200px;height:630px;background:#0c3257;overflow:hidden}
  .stripe{position:absolute;left:0;right:0;bottom:0;height:22px;background:#45b2ed}
  .stripe2{position:absolute;left:0;right:0;bottom:22px;height:8px;background:#ff95c5}
  .logo{position:absolute;top:44px;right:60px;height:74px}
  .kicker{position:absolute;top:158px;right:60px;color:#ff95c5;font-size:34px;font-weight:700;letter-spacing:.2px}
  .title{position:absolute;top:206px;right:60px;width:700px;color:#ffffff;font-size:72px;line-height:1.08;font-weight:900}
  .sub{position:absolute;top:400px;right:60px;width:700px;color:#eef2f6;font-size:27px;line-height:1.4;font-weight:500}
  .pill{position:absolute;bottom:64px;right:60px;background:#45b2ed;color:#0c3257;font-weight:800;font-size:26px;padding:14px 30px;border-radius:999px}
  .charbox{position:absolute;left:44px;bottom:30px;width:262px;height:560px;overflow:hidden}
  .char{height:560px}
</style></head><body><div class="stage">
  <img class="logo" src="${asset('logo.webp')}" alt="">
  <div class="kicker">קול קורא לעסקי תיירות</div>
  <div class="title">חודש התיירות הישראלית 2026</div>
  <div class="sub">הרשמה וחתימה דיגיטלית על הסכם ההצטרפות — בכמה דקות, מהנייד.</div>
  <div class="pill">להרשמה ולחתימה ←</div>
  <div class="charbox"><img class="char" src="${asset('character.webp')}" alt=""></div>
  <div class="stripe2"></div><div class="stripe"></div>
</div></body></html>`

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  writeFileSync('/private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', html)
  await page.goto('file:///private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', { waitUntil: 'networkidle0' })
  // Data-URI images decode after "load"; wait for every one before the shot.
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r })))))
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null))))
  console.log(await page.evaluate(() => ({ imgs: document.images.length, widths: Array.from(document.images).map((i) => i.naturalWidth), bg: getComputedStyle(document.querySelector('.stage')!).backgroundColor })))
  let png = (await page.screenshot({ type: 'png' })) as Buffer
  if (png.length < 20000) {
    // A flat frame means the compositor gave up (no GPU): render in software and try again.
    await browser.close()
    const soft = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
    const p2 = await soft.newPage()
    await p2.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
    await p2.goto('file:///private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', { waitUntil: 'networkidle0' })
    await p2.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
    await p2.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null))))
    png = (await p2.screenshot({ type: 'png' })) as Buffer
    await soft.close()
    writeFileSync('public/tourism-2026/og.png', png)
    console.log(`public/tourism-2026/og.png (${png.length} bytes, software render)`)
    return
  }
  writeFileSync('public/tourism-2026/og.png', png)
  await browser.close()
  console.log(`public/tourism-2026/og.png (${png.length} bytes)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
