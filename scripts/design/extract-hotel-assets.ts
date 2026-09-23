import { mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { renderPdf } from '../qa/render-pdf'

/**
 * Cuts the hotels' ad ("מודעה קליקבילית-1.pdf", the approved design for the
 * hotels' version of the call) into the pieces HotelCall.tsx composes: the
 * whole top as one picture, the four regional weeks with their pins, the
 * four exposure marks, the WhatsApp mark and the foot. Body copy is real
 * text on the page and is not cut.
 *
 * The ad is a PDF whose type is vector and whose pictures are embedded, so
 * it is rendered at 3× first (1676×2526) and cut from that; the boxes below
 * are in those pixels, written down from the ad at 1327 wide and scaled.
 *
 *   npx tsx scripts/design/extract-hotel-assets.ts [path/to/ad.pdf]
 *   → public/tourism-2026/hotel/*.webp
 */
const SRC = process.argv[2] ?? '.design/tourism-2026-hotel/ad.pdf'
const OUT = 'public/tourism-2026/hotel'
const S = 1676 / 1327

type Box = { name: string; left: number; top: number; right: number; bottom: number; width?: number; quality?: number }
const d = (name: string, l: number, t: number, r: number, b: number, extra: Partial<Box> = {}): Box => ({ name, left: Math.round(l * S), top: Math.round(t * S), right: Math.round(r * S), bottom: Math.round(b * S), ...extra })

const CROPS: Box[] = [
  // The whole top, cut just above the ad's first line of copy.
  d('hero', 0, 0, 1327, 733, { width: 1676, quality: 82 }),
  // The four weeks — photo, ring and pin — on the page's own white. Week 1 is the rightmost.
  d('week-1', 950, 862, 1218, 1105),
  d('week-2', 672, 862, 940, 1105),
  d('week-3', 393, 862, 661, 1105),
  d('week-4', 112, 862, 380, 1105),
  d('benefit-site', 1040, 1440, 1140, 1540),
  d('benefit-press', 758, 1440, 858, 1540),
  d('benefit-social', 475, 1440, 575, 1540),
  d('benefit-campaign', 190, 1440, 290, 1540),
  d('whatsapp', 300, 1668, 360, 1728),
  // The foot: the three views and the mark, cut just under the ad's own button.
  d('foot', 0, 1802, 1327, 2000, { width: 1676, quality: 80 }),
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [page] = await renderPdf(readFileSync(SRC), 3)
  console.log(`${SRC}: ${page.width}×${page.height}`)
  for (const box of CROPS) {
    const w = box.right - box.left
    const h = box.bottom - box.top
    let img = sharp(page.png).extract({ left: box.left, top: box.top, width: w, height: h })
    if (box.width && box.width < w) img = img.resize({ width: box.width })
    const info = await img.webp({ quality: box.quality ?? 90, effort: 6 }).toFile(`${OUT}/${box.name}.webp`)
    console.log(`${box.name}: ${info.width}×${info.height} ${Math.round(info.size / 1024)}KB`)
  }
}

void main()
