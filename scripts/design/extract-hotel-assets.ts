import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import sharp from 'sharp'
import { renderPdf } from '../qa/render-pdf'

/**
 * Cuts the hotels' ad ("מודעה קליקבילית-1.pdf", the approved design for the
 * hotels' version of the call) into the pieces HotelCall.tsx composes.
 *
 * The ad is a PDF: its photographs are embedded pictures, everything else —
 * the type, the three marks, the badge, the brush, the leaves, the rings,
 * the pins, the icons, the wave — is vector. Two renders serve the cuts:
 *
 *   • the plain render, exactly as the ad looks, for everything that is
 *     placed as the ad places it: the whole top (one picture for wide
 *     screens; the text column with the badge, for phones), the four weeks
 *     and the foot;
 *   • the vector layer, lifted with real transparency by rendering the page
 *     twice, over black and over white, with every picture painted flat as
 *     well — what differs between the two renders is background showing
 *     through, and how much of it is the alpha — for the pieces that stand
 *     somewhere else on the page: the leaves, the icons, the WhatsApp mark.
 *
 * Boxes are in the pixels of the 3× render (1676×2526).
 *
 *   npx tsx scripts/design/extract-hotel-assets.ts [path/to/ad.pdf]
 *   → public/tourism-2026/hotel/*.webp
 */
const SRC = process.argv[2] ?? '.design/tourism-2026-hotel/ad.pdf'
const OUT = 'public/tourism-2026/hotel'
const SCALE = 3
const S = 1676 / 1327 // the ad at 1327 wide, where the boxes were first written down → render pixels

type RGBA = { width: number; height: number; data: Buffer }

// ── the three renders ────────────────────────────────────────────────────────

async function renderMatte(fill: 0 | 255): Promise<RGBA> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(SRC)), useSystemFonts: false, standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' }).promise
  const page = await doc.getPage(1)
  // The worker hands every picture to the renderer as the page draws; each one is painted flat as it lands.
  const objs = page.objs as unknown as { resolve: (id: string, data: unknown) => void }
  const orig = objs.resolve.bind(objs)
  objs.resolve = (id, data) => {
    const d = data as { width?: number; height?: number; data?: Uint8ClampedArray } | null
    if (d?.data && d.width && d.height && d.data.length === d.width * d.height * 3) d.data.fill(fill)
    orig(id, data)
  }
  const viewport = page.getViewport({ scale: SCALE })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport, background: fill ? '#ffffff' : '#000000' }).promise
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  await doc.cleanup()
  return { width: canvas.width, height: canvas.height, data: Buffer.from(data.buffer) }
}

/** The vector layer: colour from the render over black, alpha from how much lighter the render over white came out. */
async function vectorLayer(): Promise<RGBA> {
  const black = await renderMatte(0)
  const white = await renderMatte(255)
  const { width, height } = black
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    let diff = 0
    for (let c = 0; c < 3; c++) diff += white.data[i * 4 + c] - black.data[i * 4 + c]
    const a = Math.max(0, Math.min(1, 1 - diff / (3 * 255)))
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a > 0 ? Math.min(255, Math.round(black.data[i * 4 + c] / a)) : 0
    out[i * 4 + 3] = Math.round(a * 255)
  }
  return { width, height, data: out }
}

// ── the cuts ─────────────────────────────────────────────────────────────────

type Box = {
  name: string
  left: number
  top: number
  right: number
  bottom: number
  /** From the vector layer (with its alpha) rather than the plain render. */
  vector?: boolean
  /** Keep only the leaf hues — the copy and the marks beside a leaf go. */
  leaf?: boolean
  /** Keep only the ring and its pin: the leaves that reach into the box go. */
  week?: boolean
  /** A box to paint over in the paper's white, in the crop's own pixels. */
  blank?: [number, number, number, number]
  width?: number
  quality?: number
}
const d = (name: string, l: number, t: number, r: number, b: number, extra: Partial<Box> = {}): Box => ({ name, left: Math.round(l * S), top: Math.round(t * S), right: Math.round(r * S), bottom: Math.round(b * S), ...extra })
const v = (name: string, left: number, top: number, right: number, bottom: number, extra: Partial<Box> = {}): Box => ({ name, left, top, right, bottom, vector: true, ...extra })
const p = (name: string, left: number, top: number, right: number, bottom: number, extra: Partial<Box> = {}): Box => ({ name, left, top, right, bottom, ...extra })

const CROPS: Box[] = [
  // The whole top, as the ad draws it, cut just above the first line of copy (its ascenders start at 926).
  p('hero', 0, 0, 1676, 924, { quality: 84 }),
  // The same top for a phone: the text column with the three marks and the badge, whole, and no terrace.
  p('hero-phone', 380, 0, 1630, 924, { quality: 84 }),
  // The leaves at the paper's edges — whole, since nothing covers them on the vector layer.
  v('leaf-weeks-right', 1440, 1061, 1676, 1446, { leaf: true }),
  v('leaf-weeks-left', 0, 1010, 253, 1408, { leaf: true }),
  v('leaf-benefits-right', 1440, 1800, 1676, 2147, { leaf: true }),
  v('leaf-benefits-left', 0, 1699, 253, 2109, { leaf: true }),
  v('benefit-site', 1314, 1819, 1440, 1945),
  v('benefit-press', 957, 1819, 1084, 1945),
  v('benefit-social', 600, 1819, 726, 1945),
  v('benefit-campaign', 240, 1819, 366, 1945),
  v('whatsapp', 368, 2095, 466, 2194),
  // The four weeks — photo, ring and pin — from the plain render. Week 1 is the rightmost.
  d('week-1', 950, 862, 1218, 1105, { week: true }),
  d('week-2', 672, 862, 940, 1105, { week: true }),
  d('week-3', 393, 862, 661, 1105, { week: true }),
  d('week-4', 99, 862, 367, 1105, { week: true }),
  // The foot: the three views under the wave. The ad's own mark is painted out; the page sets the real wordmark there.
  d('foot', 0, 1802, 1327, 2000, { width: 1676, quality: 80, blank: [728, 182, 952, 250] }),
]

/** Keep only the leaves: green, olive and yellow hues; the navy copy, a cyan mark and a coloured pin are not leaf. */
function leavesOnly(px: Buffer, w: number, h: number): Buffer {
  const out = Buffer.from(px)
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max - min
    let keep = false
    if (sat > 18) {
      const hue = max === r ? (60 * (g - b)) / sat : max === g ? 120 + (60 * (b - r)) / sat : 240 + (60 * (r - g)) / sat
      const hh = (hue + 360) % 360
      keep = hh >= 28 && hh <= 140
    }
    if (!keep) out[i * 4 + 3] = 0
  }
  return out
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [plain] = await renderPdf(readFileSync(SRC), SCALE)
  console.log(`${SRC}: ${plain.width}×${plain.height}`)
  const vector = await vectorLayer()
  const vectorPng = await sharp(vector.data, { raw: { width: vector.width, height: vector.height, channels: 4 } }).png().toBuffer()

  for (const box of CROPS) {
    const w = box.right - box.left
    const h = box.bottom - box.top
    let img = sharp(box.vector ? vectorPng : plain.png).extract({ left: box.left, top: box.top, width: w, height: h })
    if (box.blank) {
      const [l, t, r, b] = box.blank
      img = sharp(await img.composite([{ input: { create: { width: r - l, height: b - t, channels: 3, background: '#f6fdff' } }, left: l, top: t }]).toBuffer())
    }
    if (box.leaf) img = sharp(leavesOnly(await img.ensureAlpha().raw().toBuffer(), w, h), { raw: { width: w, height: h, channels: 4 } })
    // The ring and the pin, nothing else. Measured on the render: the photo is a circle of r 134 about (173,152) with a white ring around it; the pin's head is r 22 about (57,214) and its tip reaches y 270.
    if (box.week) {
      const shape = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="173" cy="152" r="142" fill="#fff"/><circle cx="57" cy="214" r="27" fill="#fff"/><polygon points="29,220 85,220 57,277" fill="#fff"/></svg>`)
      img = sharp(await img.ensureAlpha().composite([{ input: shape, blend: 'dest-in' }]).toBuffer())
    }
    if (box.width && box.width < w) img = img.resize({ width: box.width })
    const out = await img.webp({ quality: box.quality ?? 90, effort: 6, alphaQuality: 100 }).toFile(`${OUT}/${box.name}.webp`)
    console.log(`${box.name}: ${out.width}×${out.height} ${Math.round(out.size / 1024)}KB`)
  }
}

void main()
