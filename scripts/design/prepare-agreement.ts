import fontkit from '@pdf-lib/fontkit'
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, PDFString, decodePDFRawStream, rgb } from 'pdf-lib'
import { shapeForPdf } from '../../src/server/signing/pdf-text'

/**
 * Makes the digital-route copy of the Ministry's agreement.
 *
 * Two changes, and only these two.
 *
 * The original PDF ends with "יש למלא, לשמור את הקובץ ולשלוח למייל: …" — the
 * instruction for the paper route, which the self-service flow replaces.
 * This removes exactly that line from the page's content stream and nothing
 * else: every other text operator, the form fields, the graphics and the
 * page geometry stay byte-for-byte as they were.
 *
 * Then the two notes the Ministry asked for in September 2026 are set into
 * the band that line used to occupy — the only clear space on the page, below
 * the signature block and above the page edge. The body cannot be reflowed
 * without rebuilding a document people have already signed, so the notes go
 * where there is room, at the page's own margins, in its own family, with the
 * address a real link. The original file is kept untouched for traceability;
 * the project's template is made from the copy.
 *
 *   npx tsx scripts/design/prepare-agreement.ts
 *
 * Verified by scripts/design/verify-agreement.ts: text extraction (only the
 * one line missing) and a rendered pixel diff (only the footer band differs).
 */

const SOURCE = '.design/tourism-2026/agreement.pdf'
const OUTPUT = '.design/tourism-2026/agreement-digital.pdf'

/** The removed line sits at y ≈ 28pt from the bottom of the A4 page. */
const FOOTER_Y_MAX = 45

/** What the Ministry asked to have added, verbatim. */
const NOTES = [
  'הפעילות במסגרת חודש התיירות הישראלית מסובסדת על ידי משרד התיירות, ואינה מבוססת על הנחות הניתנות על ידי העסקים המשתתפים בלבד.',
  'למידע נוסף על המיזם ולצפייה באתר המקוון של חודש התיירות הישראלית: https://israeltourismmonth.co.il/',
]
const SITE = 'https://israeltourismmonth.co.il/'

/** The page's own margins, read off the form fields it already carries. */
const LEFT = 55
const RIGHT = 540
const SIZE = 8.5
const LEADING = 11.5

async function main() {
  const pdf = await PDFDocument.load(readFileSync(SOURCE), { updateMetadata: false })
  const page = pdf.getPage(0)

  // A page's content is one stream or an array of them; either way it is
  // read as one text and written back as one stream.
  const contents = page.node.context.lookup(page.node.get(PDFName.of('Contents')))
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.node.context.lookup(ref)) : [contents]
  const source = streams
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) throw new Error('expected raw content streams')
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
    })
    .join('\n')

  // Text objects are BT … ET blocks; each sets its position with Tm or Td.
  // Every block whose baseline lies in the footer band goes.
  let removed = 0
  const output = source.replace(/BT[\s\S]*?ET/g, (block) => {
    const tm = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/.exec(block)
    const td = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td/.exec(block)
    const y = tm ? Number(tm[6]) : td ? Number(td[2]) : NaN
    if (Number.isFinite(y) && y >= 0 && y <= FOOTER_Y_MAX) {
      removed++
      return ''
    }
    return block
  })
  if (removed === 0) throw new Error('footer line not found — has the source changed?')

  const replacement = PDFRawStream.of(pdf.context.obj({}), Buffer.from(output, 'latin1'))
  const ref = pdf.context.register(replacement as unknown as PDFStream)
  page.node.set(PDFName.of('Contents'), ref)

  // ── The Ministry's two notes, in the band the footer line left behind ──
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(readFileSync('src/server/signing/assets/Assistant-Regular.ttf'), { subset: true })
  const width = RIGHT - LEFT

  /** Greedy wrap on the real text; order is only decided when it is drawn. */
  const wrap = (text: string) => {
    const lines: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, SIZE) > width && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
    return lines
  }

  const blocks = NOTES.map(wrap)
  const lineCount = blocks.reduce((n, b) => n + b.length, 0)
  const height = lineCount * LEADING + (blocks.length - 1) * 4
  const top = 20 + height
  if (top > 84) throw new Error(`the notes need ${height.toFixed(0)}pt and the free band is 64pt`)

  page.drawLine({ start: { x: LEFT, y: top + 9 }, end: { x: RIGHT, y: top + 9 }, thickness: 0.5, color: rgb(0.72, 0.75, 0.79) })

  let y = top
  /** Where the address ends up on the page, for the link box. */
  let linkBox: { x: number; y: number; w: number } | null = null
  for (const lines of blocks) {
    for (const line of lines) {
      const w = font.widthOfTextAtSize(line, SIZE)
      // The page reads right to left: every line is set from the right margin.
      const x = RIGHT - w
      if (line.includes(SITE)) {
        /*
         * The address is drawn on its own.
         *
         * Run through the bidi algorithm with the rest of the line, the
         * trailing slash of the URL is a neutral at the edge of a right-to-
         * left paragraph, and it comes out in front: "/https://…". Splitting
         * the line means the Hebrew is shaped as Hebrew and the address is
         * left alone, which is what it needs.
         */
        const before = line.slice(0, line.indexOf(SITE))
        const urlWidth = font.widthOfTextAtSize(SITE, SIZE)
        page.drawText(shapeForPdf(before.trimEnd()), { x: x + urlWidth + font.widthOfTextAtSize(' ', SIZE), y, size: SIZE, font, color: rgb(0.16, 0.19, 0.24) })
        page.drawText(SITE, { x, y, size: SIZE, font, color: rgb(0.16, 0.19, 0.24) })
        linkBox = { x, y, w: urlWidth }
      } else {
        page.drawText(shapeForPdf(line), { x, y, size: SIZE, font, color: rgb(0.16, 0.19, 0.24) })
      }
      y -= LEADING
    }
    y -= 4
  }

  if (!linkBox) throw new Error('the address was not drawn — has the note changed?')
  const annots = page.node.lookup(PDFName.of('Annots'), PDFArray) ?? pdf.context.obj([])
  annots.push(
    pdf.context.register(
      pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [linkBox.x - 1, linkBox.y - 2, linkBox.x + linkBox.w + 1, linkBox.y + SIZE + 1],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(SITE) },
      }),
    ),
  )
  page.node.set(PDFName.of('Annots'), annots)

  writeFileSync(OUTPUT, await pdf.save({ useObjectStreams: false }))
  console.log(`removed ${removed} text object(s) in the footer band; set ${lineCount} line(s) of the Ministry's notes (${height.toFixed(0)}pt) with a link on ${SITE} → ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
