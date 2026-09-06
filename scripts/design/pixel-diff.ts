import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

/**
 * Renders the call page at the artwork's own width (1600) and compares it
 * with the Ministry artwork pixel by pixel. Outputs shot.png, diff.png (red =
 * mismatch), blend.png (50/50 overlay) and per-band mismatch percentages.
 *
 *   SHOT_URL=http://localhost:3057/tourism-2026 npx tsx scripts/design/pixel-diff.ts
 */

const URL = process.env.SHOT_URL ?? 'http://localhost:3057/tourism-2026'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'
const REF = '.design/tourism-2026/artwork.jpeg'
const W = 1600

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: W, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
  await page.screenshot({ path: `${OUT}/shot.png`, clip: { x: 0, y: 0, width: W, height: W } })
  await browser.close()

  const ref = await sharp(REF).raw().toBuffer({ resolveWithObject: true })
  const shot = await sharp(`${OUT}/shot.png`).raw().toBuffer({ resolveWithObject: true })
  const H = Math.min(ref.info.height, shot.info.height)
  const rc = ref.info.channels
  const sc = shot.info.channels
  const diff = Buffer.alloc(W * H * 3)
  const blend = Buffer.alloc(W * H * 3)
  let mismatch = 0
  const bandSize = 50
  const bands: number[] = new Array(Math.ceil(H / bandSize)).fill(0)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ri = (y * ref.info.width + x) * rc
      const si = (y * shot.info.width + x) * sc
      const d =
        (Math.abs(ref.data[ri] - shot.data[si]) +
          Math.abs(ref.data[ri + 1] - shot.data[si + 1]) +
          Math.abs(ref.data[ri + 2] - shot.data[si + 2])) /
        3
      const oi = (y * W + x) * 3
      const bad = d > 28
      if (bad) {
        mismatch++
        bands[Math.floor(y / bandSize)]++
      }
      const gray = (ref.data[ri] + ref.data[ri + 1] + ref.data[ri + 2]) / 3
      diff[oi] = bad ? 230 : gray * 0.5 + 90
      diff[oi + 1] = bad ? 40 : gray * 0.5 + 90
      diff[oi + 2] = bad ? 40 : gray * 0.5 + 90
      blend[oi] = (ref.data[ri] + shot.data[si]) / 2
      blend[oi + 1] = (ref.data[ri + 1] + shot.data[si + 1]) / 2
      blend[oi + 2] = (ref.data[ri + 2] + shot.data[si + 2]) / 2
    }
  }

  await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/diff.png`)
  await sharp(blend, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/blend.png`)

  console.log(`mismatch: ${((mismatch / (W * H)) * 100).toFixed(2)}% of pixels (threshold 28)`)
  bands.forEach((count, i) => {
    const pct = (count / (W * bandSize)) * 100
    if (pct > 4) console.log(`  band y=${i * bandSize}-${i * bandSize + bandSize}: ${pct.toFixed(1)}%`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
