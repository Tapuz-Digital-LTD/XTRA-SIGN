import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib'
import sharp from 'sharp'
import { renderPdf } from '../qa/render-pdf'

/**
 * The agreement's September 2026 edition opens with a title, a rule and a
 * paragraph that says what the tourism month is. That paragraph now lives
 * on the campaign's explainer page, the one a business reads before the
 * form, so the signed document should not say it a second time.
 *
 * This removes exactly that paragraph — the text objects whose baseline
 * lies in its band on page 1 — and nothing else: the title above it, the
 * rule, the pictures, every clause, every form field and page 2 stay
 * byte for byte. Then it proves it, the way verify-agreement.ts does:
 * both editions rendered and compared pixel by pixel (only the paragraph's
 * band may differ), the form fields compared by name and rectangle, the
 * text layer compared minus the paragraph's own sentences.
 *
 *   npx tsx scripts/design/strip-agreement-preamble.ts
 *     [.design/tourism-2026/agreement-with-preamble.pdf] [.design/tourism-2026/agreement-v4.pdf]
 */

const SOURCE = process.argv[2] ?? '.design/tourism-2026/agreement-with-preamble.pdf'
const OUTPUT = process.argv[3] ?? '.design/tourism-2026/agreement-v4.pdf'
const OUT = '.design/tourism-2026/preamble-diff'

/** The paragraph's four baselines sit at y 713–764 (bottom origin); the title above it at 802 stays. */
const BAND = { yMin: 700, yMax: 780 }
/** The paragraph, as the text layer carries it — each sentence must be gone from the copy and from nowhere else. */
const PARAGRAPH = 'חודש התיירות הישראלית הוא יוזמה לאומית של משרד התיירות בהפקת חברת בנדה הפקות, שמטרתה לחשוף את הקהל הרחב לעושר התרבותי, ההיסטורי והנופי של ישראל. במהלך החודש יתקיימו מאות סיורים ופעילויות ברחבי הארץ במחירים מסובסדים, במטרה לעודד תיירות פנים ולחזק את עסקי התיירות המקומיים. כל שבוע מוקדש לאזור אחר בארץ, והפעילויות מתקיימות מיום רביעי עד שבת.'

async function strip(bytes: Buffer): Promise<{ out: Uint8Array; removed: number }> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = pdf.getPage(0)
  const contents = page.node.context.lookup(page.node.get(PDFName.of('Contents')))
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.node.context.lookup(ref)) : [contents]
  const source = streams
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) throw new Error('expected raw content streams')
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
    })
    .join('\n')
  let removed = 0
  const output = source.replace(/BT[\s\S]*?ET/g, (block) => {
    const tm = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/.exec(block)
    const td = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td/.exec(block)
    const y = tm ? Number(tm[6]) : td ? Number(td[2]) : NaN
    if (Number.isFinite(y) && y >= BAND.yMin && y <= BAND.yMax) {
      removed++
      return ''
    }
    return block
  })
  if (removed !== 4) throw new Error(`expected the paragraph's 4 text objects in the band, found ${removed} — has the source changed?`)
  const replacement = PDFRawStream.of(pdf.context.obj({}), Buffer.from(output, 'latin1'))
  page.node.set(PDFName.of('Contents'), pdf.context.register(replacement as unknown as PDFStream))
  return { out: await pdf.save({ useObjectStreams: false }), removed }
}

async function textOf(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
  let out = ''
  for (let p = 1; p <= doc.numPages; p++) out += (await (await doc.getPage(p)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ')
  return out
}
const squash = (t: string) => t.replace(/\s+/g, '')

async function main() {
  const before = readFileSync(SOURCE)
  const { out, removed } = await strip(before)
  writeFileSync(OUTPUT, out)
  const after = Buffer.from(out)
  mkdirSync(OUT, { recursive: true })

  let failures = 0
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!ok) failures++
  }
  console.log(`removed ${removed} text objects (the paragraph's four lines) → ${OUTPUT} (${after.length} bytes; before ${before.length})`)

  // Fields: same names, same rectangles, same pages.
  const [docA, docB] = await Promise.all([PDFDocument.load(before), PDFDocument.load(after)])
  const fieldsOf = (doc: PDFDocument) =>
    doc.getForm().getFields().map((f) => f.acroField.getWidgets().map((w) => `${f.getName()}@p${doc.getPages().findIndex((p) => p.ref === w.P())}[${Object.values(w.getRectangle()).map((n) => n.toFixed(2)).join(',')}]`).join(' '))
  const fa = fieldsOf(docA), fb = fieldsOf(docB)
  check(`the same ${fa.length} form fields, every widget at the same place`, JSON.stringify(fa) === JSON.stringify(fb))
  check('same page count and sizes', docA.getPageCount() === docB.getPageCount() && docA.getPages().every((p, i) => JSON.stringify(p.getSize()) === JSON.stringify(docB.getPage(i).getSize())))

  // Text layer: the paragraph is gone, and nothing else changed.
  const [ta, tb] = await Promise.all([textOf(before), textOf(after)])
  check('the source carries the paragraph', squash(ta).includes(squash(PARAGRAPH)))
  check('the copy does not', !squash(tb).includes(squash(PARAGRAPH)) && !tb.includes('יוזמה לאומית'))
  check('every other character of the text layer is identical', squash(ta).replace(squash(PARAGRAPH), '') === squash(tb), `${squash(ta).length - squash(PARAGRAPH).length} vs ${squash(tb).length} chars`)
  check('the title "הסכם לחתימת בית העסק" stays', tb.includes('הסכם לחתימת בית העסק'))

  // Pixels: rendered at 2×, only the paragraph's band on page 1 may differ.
  const [ra, rb] = await Promise.all([renderPdf(before, 2), renderPdf(after, 2)])
  const scale = ra[0].height / 842
  const bandTop = Math.floor((842 - BAND.yMax - 6) * scale), bandBottom = Math.ceil((842 - BAND.yMin + 6) * scale)
  for (let p = 0; p < ra.length; p++) {
    const a = ra[p], b = rb[p]
    let inBand = 0, outside = 0
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4
        const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
        if (d > 30) { if (p === 0 && y >= bandTop && y <= bandBottom) inBand++; else outside++ }
      }
    }
    check(`page ${p + 1}: no pixel outside the paragraph's band changed`, outside === 0, `${outside} outside, ${inBand} inside the band`)
    if (p === 0) check('page 1: the band itself did change (the paragraph is gone)', inBand > 1000, `${inBand} px`)
    writeFileSync(`${OUT}/before-p${p + 1}.png`, a.png)
    writeFileSync(`${OUT}/after-p${p + 1}.png`, b.png)
  }
  // The top of page 1, before beside after, for a human eye.
  const top = Math.ceil(320 * scale)
  const w = ra[0].width
  const strip1 = await sharp(ra[0].png).extract({ left: 0, top: 0, width: w, height: top }).png().toBuffer()
  const strip2 = await sharp(rb[0].png).extract({ left: 0, top: 0, width: w, height: top }).png().toBuffer()
  await sharp({ create: { width: w * 2 + 40, height: top + 20, channels: 4, background: '#888' } })
    .composite([{ input: strip1, left: 10, top: 10 }, { input: strip2, left: w + 30, top: 10 }])
    .png()
    .toFile(`${OUT}/page1-top-before-after.png`)
  console.log(`renders in ${OUT}/ (before-p1, after-p1, before-p2, after-p2, page1-top-before-after)`)
  console.log(failures ? `\n${failures} FAILED` : '\nALL GREEN')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
