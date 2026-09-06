import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

/**
 * Cuts the campaign artwork (.design/tourism-2026/artwork.jpeg, 1600×1600,
 * the Ministry's approved design) into the pieces the landing page composes:
 * the branded typography that has no font, the icons, the character and the
 * signpost. Body copy is real text and is not cut.
 *
 * Coordinates are in the artwork's own pixels. Re-run after replacing the
 * artwork; the page positions everything by the same numbers (page.tsx).
 *
 *   npx tsx scripts/design/extract-tourism-assets.ts
 */

const SRC = '.design/tourism-2026/artwork.jpeg'
const OUT = 'public/tourism-2026'

type Box = { name: string; left: number; top: number; right: number; bottom: number }

export const CROPS: Box[] = [
  { name: 'logo', left: 70, top: 62, right: 450, bottom: 196 },
  { name: 'headline', left: 600, top: 62, right: 1545, bottom: 296 },
  { name: 'title-conditions', left: 1090, top: 420, right: 1540, bottom: 500 },
  { name: 'title-benefits', left: 1050, top: 850, right: 1540, bottom: 925 },
  { name: 'closing-script', left: 530, top: 1135, right: 1545, bottom: 1215 },
  { name: 'closing-bold', left: 700, top: 1215, right: 1550, bottom: 1336 },
  // Icons start at 1448: the text to their left ends at ~1440 and a wider box
  // catches the first letter of each line.
  { name: 'icon-discount', left: 1454, top: 550, right: 1540, bottom: 640 },
  { name: 'icon-shop', left: 1454, top: 645, right: 1540, bottom: 735 },
  { name: 'icon-shield', left: 1454, top: 738, right: 1540, bottom: 826 },
  { name: 'icon-people', left: 1454, top: 922, right: 1540, bottom: 1010 },
  { name: 'icon-megaphone', left: 840, top: 922, right: 928, bottom: 1010 },
  { name: 'icon-laptop', left: 1454, top: 1015, right: 1540, bottom: 1105 },
  // The character, boots over the pink band included: the band continues in
  // CSS from exactly where this crop ends.
  { name: 'character', left: 0, top: 210, right: 600, bottom: 1600 },
  { name: 'signpost', left: 470, top: 1340, right: 890, bottom: 1600 },
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  const image = sharp(SRC)
  const meta = await image.metadata()
  if (meta.width !== 1600 || meta.height !== 1600) throw new Error(`unexpected artwork size ${meta.width}×${meta.height}`)

  for (const box of CROPS) {
    const region = { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }
    let image = sharp(SRC).extract(region)
    if (box.name === 'character') {
      // The crop's right edge runs through the tail of two text lines
      // (the closing script's "מוגבלים!" and the second benefit's "וחיזוק");
      // those spots hold only navy and letters, so they are painted navy.
      const navy = { r: 12, g: 50, b: 87 }
      const patch = (left: number, top: number, width: number, height: number) => ({
        input: { create: { width, height, channels: 3 as const, background: navy } },
        left: left - box.left,
        top: top - box.top,
      })
      image = image.composite([patch(525, 1130, 75, 90), patch(582, 925, 18, 80)])
    }
    await image.webp({ quality: 92, effort: 6 }).toFile(`${OUT}/${box.name}.webp`)
    console.log(`${box.name}: ${region.width}×${region.height}`)
  }

  // Email clients do not all render WebP; the logo goes out as PNG on navy.
  await sharp(SRC).extract({ left: 70, top: 62, width: 380, height: 134 }).png().toFile(`${OUT}/email-logo.png`)

  // The pink band's colour and top edge, so the CSS continuation matches.
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2]] as const
  }
  const isPink = (x: number, y: number) => {
    const [r, g, b] = px(x, y)
    return r > 200 && g > 100 && g < 190 && b > 150
  }
  for (const x of [20, 700, 1000, 1300, 1580]) {
    let top = -1
    for (let y = 1300; y < 1600; y++) {
      if (isPink(x, y)) {
        top = y
        break
      }
    }
    console.log(`band top at x=${x}: y=${top}`)
  }
  const sums = [0, 0, 0]
  let n = 0
  for (let y = 1560; y < 1595; y++)
    for (let x = 950; x < 1250; x++) {
      const [r, g, b] = px(x, y)
      sums[0] += r
      sums[1] += g
      sums[2] += b
      n++
    }
  console.log('band colour', '#' + sums.map((s) => Math.round(s / n).toString(16).padStart(2, '0')).join(''))
  const navy = [0, 0, 0]
  n = 0
  for (let y = 300; y < 900; y += 3)
    for (let x = 640; x < 900; x += 3) {
      const [r, g, b] = px(x, y)
      if (r < 40 && g < 80 && b < 120) {
        navy[0] += r
        navy[1] += g
        navy[2] += b
        n++
      }
    }
  console.log('navy colour', '#' + navy.map((s) => Math.round(s / n).toString(16).padStart(2, '0')).join(''))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
