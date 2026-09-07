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

const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;font-family:Heebo,Arial,sans-serif}
  .stage{position:relative;width:1200px;height:630px;background:#0c3257;
    background-image:radial-gradient(120% 140% at 100% 0%, #16457a 0%, #0c3257 55%, #071f38 100%)}
  .band{position:absolute;inset:0;background:linear-gradient(174.5deg, transparent 0 66%, #45b2ed 66% 100%)}
  .band2{position:absolute;inset:0;background:linear-gradient(174.5deg, transparent 0 84%, #ff95c5 84% 100%);width:640px}
  .logo{position:absolute;top:44px;right:56px;height:78px}
  .headline{position:absolute;top:150px;right:56px;width:640px}
  .sub{position:absolute;top:388px;right:60px;width:600px;color:#eef2f6;font-size:30px;line-height:1.35;font-weight:500}
  .sub b{color:#ff95c5}
  .char{position:absolute;left:24px;bottom:-96px;height:640px}
  .pill{position:absolute;bottom:40px;right:60px;background:#fff;color:#0c3257;font-weight:700;font-size:26px;padding:14px 28px;border-radius:999px}
</style></head><body><div class="stage">
  <div class="band"></div><div class="band2"></div>
  <img class="logo" src="${asset('logo.webp')}" alt="">
  <img class="headline" src="${asset('headline.webp')}" alt="">
  <div class="sub">בעלי עסקים בתחום התיירות מוזמנים להצטרף, להירשם <b>ולחתום דיגיטלית</b> על הסכם ההצטרפות.</div>
  <div class="pill">הרשמה וחתימה בכמה דקות ←</div>
  <img class="char" src="${asset('character.webp')}" alt="">
</div></body></html>`

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  writeFileSync('/private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', html)
  await page.goto('file:///private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', { waitUntil: 'load' })
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
    await p2.goto('file:///private/tmp/claude-501/-Users-macbookpro-dev-xtra-sign/d84c6f07-f66b-44a5-8ca9-6bd5b84d8740/scratchpad/og.html', { waitUntil: 'load' })
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
