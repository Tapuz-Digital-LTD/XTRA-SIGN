import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const REF = '.design/tourism-2026/reference.png'
const OUT = 'public/tourism-2026'
mkdirSync(OUT, { recursive: true })

type Rect = { left: number; top: number; right: number; bottom: number }

// Text areas inside the hero white blob to scrub (replaced by real HTML text).
// Bounds chosen to stay clear of the corner photos (the colour classifier
// would otherwise catch pool water / sky, which are also blue).
const SCRUB: Rect[] = [
  { left: 230, top: 233, right: 650, bottom: 315 }, // title line 1
  { left: 182, top: 315, right: 706, bottom: 402 }, // title line 2
  { left: 252, top: 400, right: 655, bottom: 474 }, // בנובמבר 2026
  { left: 225, top: 558, right: 648, bottom: 712 }, // body copy
]

async function main() {
  const hero = sharp(REF).extract({ left: 0, top: 0, width: 862, height: 791 })
  const { data, info } = await hero.raw().toBuffer({ resolveWithObject: true })
  const { width, channels } = info

  const bright = (x: number, y: number) => {
    const i = (y * width + x) * channels
    return (data[i] + data[i + 1] + data[i + 2]) / 3
  }
  // Blob boundary on a row: first/last x with 25 consecutive bright pixels.
  const blobSpan = (y: number): [number, number] => {
    let left = 0
    for (let x = 0; x < width - 25; x++) {
      let ok = true
      for (let k = 0; k < 25; k++) if (bright(x + k, y) < 228) { ok = false; break }
      if (ok) { left = x; break }
    }
    let right = width - 1
    for (let x = width - 1; x >= 25; x--) {
      let ok = true
      for (let k = 0; k < 25; k++) if (bright(x - k, y) < 228) { ok = false; break }
      if (ok) { right = x; break }
    }
    return [left, right]
  }

  // Text-free rows inside the blob, bracketing every scrub rect. The fill for
  // any (x, y) is a vertical interpolation between the anchors around y, so it
  // reproduces the blob's own gradient with no seams and no glyph ghosts.
  const ANCHORS = [222, 318, 550, 720]
  const anchorColor = (x: number, ay: number): [number, number, number] | null => {
    const sums = [0, 0, 0]
    let n = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(width - 1, Math.max(0, x + dx))
        const yy = ay + dy
        if (bright(xx, yy) < 238) continue
        const i = (yy * width + xx) * channels
        for (let c = 0; c < 3; c++) sums[c] += data[i + c]
        n++
      }
    }
    if (n < 5) return null
    return [sums[0] / n, sums[1] / n, sums[2] / n]
  }

  // Text pixels by colour (navy title/body, turquoise date), dilated to cover
  // the anti-aliased halo/glow, filled with the anchor-interpolated blob tone.
  const height = info.height
  const isText = (x: number, y: number) => {
    const i = (y * width + x) * channels
    const [rr, gg, bb] = [data[i], data[i + 1], data[i + 2]]
    const lum = (rr + gg + bb) / 3
    return bb - rr > 25 && rr < 200 && lum < 228
  }
  const mask = new Uint8Array(width * height)
  for (const r of SCRUB) {
    for (let y = r.top; y <= r.bottom; y++) {
      for (let x = r.left; x <= r.right; x++) {
        if (isText(x, y)) mask[y * width + x] = 1
      }
    }
  }
  const DIL = 9
  const dilated = new Uint8Array(width * height)
  for (const r of SCRUB) {
    for (let y = r.top; y <= r.bottom; y++) {
      for (let x = r.left; x <= r.right; x++) {
        let hit = 0
        for (let dy = -DIL; dy <= DIL && !hit; dy++) {
          for (let dx = -DIL; dx <= DIL; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue
            if (mask[yy * width + xx]) { hit = 1; break }
          }
        }
        dilated[y * width + x] = hit
      }
    }
  }
  for (const r of SCRUB) {
    const above = Math.max(...ANCHORS.filter((a) => a <= r.top))
    for (let y = r.top; y <= r.bottom; y++) {
      const belowCands = ANCHORS.filter((a) => a > y)
      const aAbove = Math.max(...ANCHORS.filter((a) => a <= y), above)
      const aBelow = belowCands.length ? Math.min(...belowCands) : aAbove
      const t = aBelow === aAbove ? 0 : (y - aAbove) / (aBelow - aAbove)
      let lastGood: [number, number, number] = [247, 249, 251]
      for (let x = r.left; x <= r.right; x++) {
        if (!dilated[y * width + x]) continue
        const ca = anchorColor(x, aAbove)
        const cb = anchorColor(x, aBelow)
        const rgb: [number, number, number] =
          ca && cb
            ? ([0, 1, 2].map((c) => ca[c] * (1 - t) + cb[c] * t) as [number, number, number])
            : ca ?? cb ?? lastGood
        lastGood = rgb
        const i = (y * width + x) * channels
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(rgb[c])
      }
    }
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels } })
    .png()
    .toFile(`${OUT}/hero-bg.png`)

  await sharp(REF).extract({ left: 235, top: 45, width: 395, height: 165 }).png().toFile(`${OUT}/logo.png`)
  await sharp(REF).extract({ left: 195, top: 460, width: 475, height: 100 }).png().toFile(`${OUT}/slogan.png`)
  await sharp(REF).extract({ left: 0, top: 1668, width: 862, height: 156 }).png().toFile(`${OUT}/artwork.png`)
  await sharp(REF).extract({ left: 95, top: 1160, width: 145, height: 145 }).png().toFile(`${OUT}/agreement-icon.png`)

  await sharp(REF).extract({ left: 0, top: 0, width: 300, height: 310 }).png().toFile(`${OUT}/photo-hotel.png`)
  await sharp(REF).extract({ left: 560, top: 0, width: 302, height: 330 }).png().toFile(`${OUT}/photo-village.png`)
  await sharp(REF).extract({ left: 0, top: 340, width: 300, height: 430 }).png().toFile(`${OUT}/photo-museum.png`)
  await sharp(REF).extract({ left: 570, top: 360, width: 292, height: 420 }).png().toFile(`${OUT}/photo-nature.png`)

  console.log('assets written to', OUT)
}
main()
