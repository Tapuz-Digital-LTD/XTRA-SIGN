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

type Box = { name: string; left: number; top: number; right: number; bottom: number; width?: number; quality?: number; /** Cut out of the paper: the page's own white shows through. */ keyed?: boolean; /** A box to paint over in the paper's white, in the crop's own pixels (the ad's own mark, replaced on the page). */ blank?: [number, number, number, number]; /** Keep only the ring and its pin: the leaves that reach into the box go. */ week?: boolean }
const d = (name: string, l: number, t: number, r: number, b: number, extra: Partial<Box> = {}): Box => ({ name, left: Math.round(l * S), top: Math.round(t * S), right: Math.round(r * S), bottom: Math.round(b * S), ...extra })

const CROPS: Box[] = [
  // The whole top, cut just above the ad's first line of copy.
  d('hero', 0, 0, 1327, 733, { width: 1676, quality: 82 }),
  // The four weeks — photo, ring and pin — on the page's own white. Week 1 is the rightmost.
  d('week-1', 950, 862, 1218, 1105, { week: true }),
  d('week-2', 672, 862, 940, 1105, { week: true }),
  d('week-3', 393, 862, 661, 1105, { week: true }),
  d('week-4', 99, 862, 367, 1105, { week: true }),
  d('benefit-site', 1040, 1440, 1140, 1540),
  d('benefit-press', 758, 1440, 858, 1540),
  d('benefit-social', 475, 1440, 575, 1540),
  d('benefit-campaign', 190, 1440, 290, 1540),
  d('whatsapp', 291, 1659, 369, 1737),
  // The leaves at the paper's edges, beside the weeks and beside the exposure marks.
  d('leaf-weeks-right', 1222, 850, 1327, 1100, { keyed: true }),
  d('leaf-weeks-left', 0, 802, 108, 1110, { keyed: true }),
  d('leaf-benefits-right', 1215, 1430, 1327, 1660, { keyed: true }),
  d('leaf-benefits-left', 0, 1350, 140, 1660, { keyed: true }),
  // The foot: the three views and the mark, cut just under the ad's own button.
  // The foot: the three views under the wave. The ad's own mark is painted out; the page sets the real wordmark there.
  d('foot', 0, 1802, 1327, 2000, { width: 1676, quality: 80, blank: [728, 182, 952, 250] }),
]

/**
 * Lifts a leaf off the paper. The paper is white, or the faint blue the ad
 * tints it; a leaf is green, olive and yellow — every channel well under
 * 255. How far the darkest channel sits below white is how much leaf a
 * pixel is, on a ramp so the soft edges stay soft.
 */
function keyOut({ data, info }: { data: Buffer; info: { width: number; height: number; channels: number } }): Buffer {
  const { width, height, channels } = info
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2]
    const depth = 255 - Math.min(r, g, b)
    const a = Math.max(0, Math.min(1, (depth - 22) / 70))
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.round(a * 255)
  }
  return out
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [page] = await renderPdf(readFileSync(SRC), 3)
  console.log(`${SRC}: ${page.width}×${page.height}`)
  for (const box of CROPS) {
    const w = box.right - box.left
    const h = box.bottom - box.top
    let img = sharp(page.png).extract({ left: box.left, top: box.top, width: w, height: h })
    if (box.blank) {
      const [l, t, r, b] = box.blank
      img = sharp(await img.composite([{ input: { create: { width: r - l, height: b - t, channels: 3, background: '#f6fdff' } }, left: l, top: t }]).toBuffer())
    }
    if (box.keyed) img = sharp(await keyOut(await img.raw().toBuffer({ resolveWithObject: true })), { raw: { width: w, height: h, channels: 4 } })
    // The ring and the pin, nothing else: the boxes touch the leaves beside them, and a leaf tip in a corner is not the week's.
    if (box.week) {
      // Measured on the render: the photo is a circle of r 134 about (173,152) with a white ring around it; the pin's head is r 22 about (57,214) and its tip reaches y 270.
      const shape = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="173" cy="152" r="142" fill="#fff"/><circle cx="57" cy="214" r="27" fill="#fff"/><polygon points="29,220 85,220 57,277" fill="#fff"/></svg>`)
      img = sharp(await img.ensureAlpha().composite([{ input: shape, blend: 'dest-in' }]).toBuffer())
    }
    if (box.width && box.width < w) img = img.resize({ width: box.width })
    const info = await img.webp({ quality: box.quality ?? 90, effort: 6, alphaQuality: 100 }).toFile(`${OUT}/${box.name}.webp`)
    console.log(`${box.name}: ${info.width}×${info.height} ${Math.round(info.size / 1024)}KB`)
  }
}

void main()
