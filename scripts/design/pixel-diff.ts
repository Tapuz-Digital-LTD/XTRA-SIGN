import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

/**
 * Renders /tourism-2026 at the canonical 862px width and compares it with the
 * Ministry reference. Outputs: shot.png, diff.png (red = mismatch), blend.png
 * (50/50 overlay), and per-band mismatch stats.
 */

const URL = process.env.SHOT_URL ?? 'http://localhost:3057/tourism-2026'
const OUT = process.env.SHOT_OUT ?? '.design/tourism-2026'
const REF = '.design/tourism-2026/reference.png'

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 862, height: 1000, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 400))
  // The Next dev-tools indicator must not appear in the comparison.
  await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
  await page.screenshot({ path: `${OUT}/shot.png`, fullPage: true })
  await browser.close()

  const refImg = await sharp(REF).raw().toBuffer({ resolveWithObject: true })
  const shotImg = await sharp(`${OUT}/shot.png`).raw().toBuffer({ resolveWithObject: true })
  const W = 862
  const H = Math.min(refImg.info.height, shotImg.info.height)
  console.log(`ref height=${refImg.info.height} shot height=${shotImg.info.height}`)

  const rc = refImg.info.channels
  const sc = shotImg.info.channels
  const diff = Buffer.alloc(W * H * 3)
  const blend = Buffer.alloc(W * H * 3)
  let mismatch = 0
  const bandSize = 50
  const bands: number[] = new Array(Math.ceil(H / bandSize)).fill(0)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ri = (y * refImg.info.width + x) * rc
      const si = (y * shotImg.info.width + x) * sc
      const dr = Math.abs(refImg.data[ri] - shotImg.data[si])
      const dg = Math.abs(refImg.data[ri + 1] - shotImg.data[si + 1])
      const db = Math.abs(refImg.data[ri + 2] - shotImg.data[si + 2])
      const d = (dr + dg + db) / 3
      const oi = (y * W + x) * 3
      const bad = d > 24
      if (bad) {
        mismatch++
        bands[Math.floor(y / bandSize)]++
      }
      // diff: grayscale ref dimmed, mismatches red
      const gray = (refImg.data[ri] + refImg.data[ri + 1] + refImg.data[ri + 2]) / 3
      diff[oi] = bad ? 230 : gray * 0.5 + 90
      diff[oi + 1] = bad ? 40 : gray * 0.5 + 90
      diff[oi + 2] = bad ? 40 : gray * 0.5 + 90
      blend[oi] = (refImg.data[ri] + shotImg.data[si]) / 2
      blend[oi + 1] = (refImg.data[ri + 1] + shotImg.data[si + 1]) / 2
      blend[oi + 2] = (refImg.data[ri + 2] + shotImg.data[si + 2]) / 2
    }
  }

  await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/diff.png`)
  await sharp(blend, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/blend.png`)

  console.log(`mismatch: ${((mismatch / (W * H)) * 100).toFixed(2)}% of pixels (threshold 24)`)
  bands.forEach((count, i) => {
    const pct = (count / (W * bandSize)) * 100
    if (pct > 8) console.log(`  band y=${i * bandSize}-${i * bandSize + bandSize}: ${pct.toFixed(1)}%`)
  })
}
main()
