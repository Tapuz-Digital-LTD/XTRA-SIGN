import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

/**
 * Cuts the campaign artwork (.design/tourism-2026/artwork.jpeg, 1600×1600,
 * the Ministry's approved design) into the pieces the landing page composes:
 * the branded typography that has no font, the icons, the landscape and the
 * signpost. Body copy is real text and is not cut.
 *
 * Coordinates are in the artwork's own pixels. Re-run after replacing the
 * artwork; the page positions everything by the same numbers (page.tsx).
 *
 * Two pieces do not come from a plain rectangle:
 *   • the signpost stands over navy, the white card and the pink band at
 *     once, so it is keyed to transparency (its own colour, holes filled);
 *   • the Ministry's white-on-navy logo is not in this year's artwork — that
 *     one puts the dark logo on the sky — so the emails, the closed page and
 *     the phone header keep taking it from last year's file, PREV below.
 *
 *   npx tsx scripts/design/extract-tourism-assets.ts
 */

const SRC = '.design/tourism-2026/artwork.jpeg'
/** Last year's artwork: the only place the logo exists white on navy. */
const PREV = '.design/tourism-2026/artwork-2025.jpeg'
const OUT = 'public/tourism-2026'

type Box = {
  name: string
  left: number
  top: number
  right: number
  bottom: number
  keyed?: boolean
  /** The ink, when the box also holds a brighter piece of the landscape. */
  ink?: [number, number, number]
}

export const CROPS: Box[] = [
  // The landscape, cut just before the leftmost letter of the real copy
  // (x=684, the third body line) so the page can lay its own text over it.
  // The closing script's own crop starts further left, at 653, and is drawn
  // on top — the two show the same pixels there, so the overlap is invisible.
  { name: 'scene', left: 0, top: 0, right: 682, bottom: 1600 },
  // Below the copy the landscape reaches much further right — to x≈850 at the
  // closing line — and cutting it at 682 left the last letter of that line
  // half on rock and half on navy. This is the rest of it, an exact crop. The
  // white card and the closing line are inside it, and the page draws both
  // over their own pixels, in the same places.
  { name: 'scene-foot', left: 682, top: 1040, right: 850, bottom: 1600 },
  // The production company's mark, white on navy, top right.
  { name: 'producer-logo', left: 1296, top: 54, right: 1512, bottom: 166, keyed: true },
  // Handwritten and display type: no font ships these. The boxes stop
  // short of the copy above and below — each is an opaque rectangle, and an
  // overlap would cut the letters of the real text under it.
  { name: 'headline-script', left: 750, top: 180, right: 1510, bottom: 283, keyed: true },
  { name: 'headline-title', left: 763, top: 283, right: 1511, bottom: 472, keyed: true },
  { name: 'title-conditions', left: 1130, top: 698, right: 1535, bottom: 784, keyed: true },
  { name: 'title-benefits', left: 1006, top: 995, right: 1532, bottom: 1094, keyed: true },
  // Between the megaphone above it (ends y=1256) and the signpost below it
  // (starts y=1359): both are the same cyan, and a taller box would key a
  // slice of them into the sentence.
  { name: 'closing-script', left: 653, top: 1260, right: 1535, bottom: 1352, keyed: true, ink: [73, 179, 240] },
  // The four line icons, in the gutter to the left of their text.
  { name: 'icon-shop', left: 1464, top: 833, right: 1527, bottom: 890, keyed: true },
  { name: 'icon-shield', left: 1466, top: 921, right: 1530, bottom: 984, keyed: true },
  { name: 'icon-laptop', left: 1456, top: 1088, right: 1532, bottom: 1167, keyed: true },
  { name: 'icon-megaphone', left: 1460, top: 1188, right: 1534, bottom: 1262, keyed: true },
]

/**
 * A branded piece lifted off the navy field with a real alpha channel.
 *
 * These are flat one-colour graphics — pink handwriting, cyan display type,
 * cyan line icons — printed on navy. For each pixel, how far it has travelled
 * from the field towards the ink is its coverage; a pixel that moved in some
 * other direction (the landscape showing under the closing line) has not been
 * touched by the ink at all and stays transparent.
 *
 * Cutting them out instead of cropping rectangles is what lets the same asset
 * sit on the canvas, on the photograph and on a phone's navy header without a
 * visible plate around it.
 */
async function keyOut(box: Box) {
  const w = box.right - box.left
  const h = box.bottom - box.top
  const { data } = await sharp(SRC).extract({ left: box.left, top: box.top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true })

  // The field, measured on this crop's own border rather than assumed: the
  // artwork's navy drifts across the poster, and a guess a few points off
  // leaves a faint plate behind the letters.
  const edge: number[] = []
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) edge.push(y * w + x)
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) edge.push(y * w + x)
  const field = [0, 1, 2].map((c) => {
    const values = edge.map((i) => data[i * 3 + c]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  })
  const at = (i: number) => [data[i * 3] - field[0], data[i * 3 + 1] - field[1], data[i * 3 + 2] - field[2]] as const

  // The ink: the average of the pixels furthest from the field.
  const far = [...Array(w * h).keys()]
    .map((i) => ({ i, d: at(i).reduce((a, v) => a + v * v, 0) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, Math.max(24, Math.round(w * h * 0.004)))
  // The sentence over the landscape has white rock in its box, further from
  // the field than its own cyan, so that one names its ink outright.
  const ink = box.ink ?? [0, 1, 2].map((c) => Math.round(far.reduce((a, { i }) => a + data[i * 3 + c], 0) / far.length))
  const dir = [ink[0] - field[0], ink[1] - field[1], ink[2] - field[2]]
  const len2 = dir.reduce((a, v) => a + v * v, 0)

  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const p = at(i)
    const t = (p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / len2
    // How much of the pixel is not explained by the ink: colour that moved
    // somewhere else is background, not a soft edge.
    const off = Math.sqrt([0, 1, 2].reduce((a, c) => a + (p[c] - t * dir[c]) ** 2, 0))
    // Colour that moved somewhere other than towards the ink is background,
    // but the judgement is a ramp rather than a cliff: a hard cut leaves the
    // letters with stepped, crawling edges where the JPEG blurred them.
    const along = Math.max(0, Math.min(1, (t - 0.04) / 0.94))
    const belongs = Math.max(0, Math.min(1, (26 - off) / 14))
    const a = along * belongs
    rgba[i * 4] = ink[0]
    rgba[i * 4 + 1] = ink[1]
    rgba[i * 4 + 2] = ink[2]
    rgba[i * 4 + 3] = Math.round(a * 255)
  }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 95, effort: 6, alphaQuality: 100 }).toFile(`${OUT}/${box.name}.webp`)
  console.log(`${box.name}: ${w}×${h} keyed, ink #${ink.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
}

/** Where the signpost is looked for; the shape decides its own bounds. */
const SIGNPOST = { left: 1230, top: 1340, right: 1580, bottom: 1596 }

/**
 * The signpost, keyed out of three different backgrounds.
 *
 * Its own colour is the light cyan of the sign and the darker cyan of the
 * post; the navy letters inside it are holes in that shape, so anything the
 * background cannot reach from the outside is kept. The soft drop shadow is
 * not part of the shape and is dropped — the page casts its own.
 */
async function signpost() {
  const w = SIGNPOST.right - SIGNPOST.left
  const h = SIGNPOST.bottom - SIGNPOST.top
  const { data } = await sharp(SRC).extract({ left: SIGNPOST.left, top: SIGNPOST.top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => (y * w + x) * 3
  const isSign = (x: number, y: number) => {
    const i = at(x, y)
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    return b > 140 && b - r > 45 && g > 95 && g < 215
  }

  const sign = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isSign(x, y)) sign[y * w + x] = 1

  // Everything the outside can walk to over non-sign pixels is background.
  const outside = new Uint8Array(w * h)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    const i = y * w + x
    if (x < 0 || y < 0 || x >= w || y >= h || outside[i] || sign[i]) return
    outside[i] = 1
    queue.push(i)
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  while (queue.length) {
    const i = queue.pop() as number
    const x = i % w
    const y = (i - x) / w
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }

  /** Pixels of one connected run of `of`, starting at i. */
  const component = (i0: number, of: Uint8Array, seen: Uint8Array) => {
    const cells = [i0]
    seen[i0] = 1
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k]
      const x = i % w
      const y = (i - x) / w
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (!seen[j] && of[j]) {
          seen[j] = 1
          cells.push(j)
        }
      }
    }
    return cells
  }

  // The upper sign and the post are drawn as outlines: their insides are
  // background showing through, not part of the shape. What must be painted
  // back in is only the navy lettering on the filled board — small runs, and
  // all of them below the board's top edge (artwork y=1440).
  const BOARD_TOP = 1440 - SIGNPOST.top
  const hole = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (!sign[i] && !outside[i]) hole[i] = 1
  const seenHole = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!hole[i] || seenHole[i]) continue
    const cells = component(i, hole, seenHole)
    const top = Math.min(...cells.map((c) => (c - (c % w)) / w))
    if (cells.length >= 600 || top < BOARD_TOP) for (const c of cells) outside[c] = 1
  }

  // JPEG noise leaves cyan specks around the sign; drop the tiny runs.
  const seenSign = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!sign[i] || seenSign[i]) continue
    const cells = component(i, sign, seenSign)
    if (cells.length < 60) for (const c of cells) outside[c] = 1
  }

  const rgba = Buffer.alloc(w * h * 4)
  let left = w
  let top = h
  let right = -1
  let bottom = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const keep = !outside[i]
      const s = at(x, y)
      const d = i * 4
      rgba[d] = data[s]
      rgba[d + 1] = data[s + 1]
      rgba[d + 2] = data[s + 2]
      rgba[d + 3] = keep ? 255 : 0
      if (keep) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }

  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    // A one-pixel blur softens the key without eating the shape.
    .blur(0.4)
    .webp({ quality: 95, effort: 6, alphaQuality: 100 })
    .toFile(`${OUT}/signpost.webp`)
  console.log(`signpost: ${right - left + 1}×${bottom - top + 1} at ${SIGNPOST.left + left},${SIGNPOST.top + top} (transparent)`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const meta = await sharp(SRC).metadata()
  if (meta.width !== 1600 || meta.height !== 1600) throw new Error(`unexpected artwork size ${meta.width}×${meta.height}`)

  for (const box of CROPS) {
    if (box.keyed) {
      await keyOut(box)
      continue
    }
    const region = { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }
    await sharp(SRC).extract(region).webp({ quality: 92, effort: 6 }).toFile(`${OUT}/${box.name}.webp`)
    console.log(`${box.name}: ${region.width}×${region.height}`)
  }

  await signpost()

  // White on navy, from last year's file: the phone header, the closed page
  // and the emails all put the logo on the campaign's navy.
  await sharp(PREV).extract({ left: 70, top: 62, width: 380, height: 134 }).webp({ quality: 95, effort: 6 }).toFile(`${OUT}/logo.webp`)
  // Email clients do not all render WebP; the logo goes out as PNG on navy.
  await sharp(PREV).extract({ left: 70, top: 62, width: 380, height: 134 }).png().toFile(`${OUT}/email-logo.png`)
  console.log('logo + email-logo: 380×134 (from last year\'s artwork, white on navy)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
