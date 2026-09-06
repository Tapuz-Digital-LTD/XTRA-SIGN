import { readFileSync, writeFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib'

/**
 * Makes the digital-route copy of the Ministry's agreement.
 *
 * The original PDF ends with "יש למלא, לשמור את הקובץ ולשלוח למייל: …" — the
 * instruction for the paper route, which the self-service flow replaces.
 * This removes exactly that line from the page's content stream and nothing
 * else: every other text operator, the form fields, the graphics and the
 * page geometry stay byte-for-byte as they were. The original file is kept
 * untouched for traceability; the project's template is made from the copy.
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

  writeFileSync(OUTPUT, await pdf.save({ useObjectStreams: false }))
  console.log(`removed ${removed} text object(s) in the footer band → ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
