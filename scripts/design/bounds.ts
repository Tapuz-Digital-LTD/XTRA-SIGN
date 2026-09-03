import sharp from 'sharp'

/** Bounding boxes of "ink" (non-background pixels) in named regions, ref vs shot. */

type Region = { name: string; x0: number; y0: number; x1: number; y1: number; mode: 'dark' | 'light' }

const REGIONS: Region[] = [
  { name: 'title-line1', x0: 235, y0: 238, x1: 655, y1: 314, mode: 'dark' },
  { name: 'title-line2', x0: 195, y0: 320, x1: 700, y1: 400, mode: 'dark' },
  { name: 'date', x0: 250, y0: 402, x1: 650, y1: 472, mode: 'dark' },
  { name: 'body-l1', x0: 265, y0: 552, x1: 640, y1: 608, mode: 'dark' },
  { name: 'body-l3', x0: 265, y0: 655, x1: 640, y1: 712, mode: 'dark' },
  { name: 'benefits-heading', x0: 200, y0: 810, x1: 680, y1: 872, mode: 'light' },
  { name: 'benefit1-icon', x0: 645, y0: 875, x1: 780, y1: 966, mode: 'light' },
  { name: 'benefit1-title', x0: 645, y0: 968, x1: 780, y1: 1008, mode: 'light' },
  { name: 'benefit1-text', x0: 620, y0: 1008, x1: 800, y1: 1070, mode: 'light' },
  { name: 'card-heading', x0: 150, y0: 1125, x1: 730, y1: 1190, mode: 'dark' },
  { name: 'underline', x0: 350, y0: 1185, x1: 520, y1: 1225, mode: 'dark' },
  { name: 'label1', x0: 670, y0: 1250, x1: 830, y1: 1320, mode: 'dark' },
  { name: 'label2', x0: 670, y0: 1330, x1: 830, y1: 1410, mode: 'dark' },
  { name: 'label3', x0: 670, y0: 1415, x1: 830, y1: 1495, mode: 'dark' },
  { name: 'select-value', x0: 540, y0: 1425, x1: 660, y1: 1490, mode: 'dark' },
  { name: 'agr-icon', x0: 70, y0: 1230, x1: 270, y1: 1378, mode: 'dark' },
  { name: 'agr-text', x0: 70, y0: 1380, x1: 270, y1: 1450, mode: 'dark' },
  { name: 'cta', x0: 200, y0: 1570, x1: 660, y1: 1680, mode: 'dark' },
]

async function bounds(path: string) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  const { width, channels } = info
  return (r: Region) => {
    let minX = -1, maxX = -1, minY = -1, maxY = -1
    for (let y = r.y0; y <= Math.min(r.y1, info.height - 1); y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = (y * width + x) * channels
        const [rr, gg, bb] = [data[i], data[i + 1], data[i + 2]]
        const lum = (rr + gg + bb) / 3
        const isInk = r.mode === 'dark' ? lum < 150 : lum > 140
        if (isInk) {
          if (minX < 0 || x < minX) minX = x
          if (x > maxX) maxX = x
          if (minY < 0 || y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2 }
  }
}

async function main() {
  const ref = await bounds('.design/tourism-2026/reference.png')
  const shot = await bounds('.design/tourism-2026/shot.png')
  for (const r of REGIONS) {
    const a = ref(r)
    const b = shot(r)
    console.log(
      `${r.name}: ref x${a.minX}-${a.maxX} y${a.minY}-${a.maxY} (w${a.w} h${a.h} cx${a.cx}) | shot x${b.minX}-${b.maxX} y${b.minY}-${b.maxY} (w${b.w} h${b.h} cx${b.cx})`,
    )
  }
}
main()
