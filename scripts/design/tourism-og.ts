import { readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

/**
 * The share image for the Ministry of Tourism campaign: a 1200×630
 * composition of the campaign's own assets — the landscape, the handwritten
 * kicker, the display headline, both marks — on its own colours, laid out
 * for a horizontal preview card. Nothing invented: no new logos, no new
 * text; every line here is on the poster.
 *
 *   npx tsx scripts/design/tourism-og.ts   → public/tourism-2026/og.png
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SCRATCH = process.env.SCRATCH ?? '/private/tmp'
const asset = (name: string, type = 'webp') => `data:image/${type};base64,${readFileSync(`public/tourism-2026/${name}`).toString('base64')}`

const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;font-family:Heebo,Arial,sans-serif}
  .stage{position:relative;width:1200px;height:630px;background:#0c3257;overflow:hidden}
  /* The landscape holds the left third and fades into the navy field, as it
     does on the poster. */
  .scene{position:absolute;left:0;top:0;width:430px;height:630px;object-fit:cover;object-position:52% 62%}
  .fade{position:absolute;left:236px;top:0;width:216px;height:630px;
    background:linear-gradient(to right,rgba(12,50,87,0),#0c3257)}
  .bar{position:absolute;left:0;top:0;width:1200px;height:104px;background:#0c3257}
  .ministry{position:absolute;left:44px;top:26px;height:52px}
  .producer{position:absolute;right:44px;top:24px;height:56px}
  .kicker{position:absolute;right:44px;top:146px;width:640px}
  .title{position:absolute;right:44px;top:214px;width:600px}
  .line{position:absolute;right:44px;top:432px;width:640px;color:#eef2f6;font-size:26px;line-height:36px;font-weight:400;text-align:right}
  .pill{position:absolute;right:44px;top:520px;display:inline-flex;align-items:center;gap:14px;
    background:#45b2ed;color:#0c3257;font-weight:700;font-size:27px;padding:16px 34px;border-radius:999px}
  .band{position:absolute;left:-40px;bottom:-96px;width:1320px;height:150px;background:#ff95c5;transform:rotate(-5.53deg)}
</style></head><body><div class="stage">
  <img class="scene" src="${asset('scene.webp')}" alt="">
  <div class="fade"></div>
  <div class="band"></div>
  <div class="bar"></div>
  <img class="ministry" src="${asset('logo.webp')}" alt="">
  <img class="producer" src="${asset('producer-logo.webp')}" alt="">
  <img class="kicker" src="${asset('headline-script.webp')}" alt="">
  <img class="title" src="${asset('headline-title.webp')}" alt="">
  <div class="line">ארבעה שבועות של פעילות, בימים רביעי עד שבת.<br>להצטרפות עד: 22 בספטמבר 2026</div>
  <div class="pill">מכאן מצטרפים <span>←</span></div>
</div></body></html>`

async function shoot(args: string[] = []) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  writeFileSync(`${SCRATCH}/tourism-og.html`, html)
  await page.goto(`file://${SCRATCH}/tourism-og.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  // Data-URI images decode after "load"; wait for every one before the shot.
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r })))))
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null))))
  const png = (await page.screenshot({ type: 'png' })) as Buffer
  await browser.close()
  return png
}

async function main() {
  let png = await shoot()
  // A flat frame means the compositor gave up (no GPU): render in software.
  if (png.length < 20000) png = await shoot(['--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
  writeFileSync('public/tourism-2026/og.png', png)
  console.log(`public/tourism-2026/og.png (${png.length} bytes)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
