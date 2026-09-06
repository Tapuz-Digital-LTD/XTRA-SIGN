import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'

/**
 * Proves the digital copy of the agreement differs from the original in the
 * removed footer line and in nothing else: same text elsewhere, same form
 * fields and geometry, and a rendered pixel diff confined to the footer band.
 *
 *   npx tsx scripts/design/verify-agreement.ts
 */

const ORIGINAL = '.design/tourism-2026/agreement.pdf'
const DIGITAL = '.design/tourism-2026/agreement-digital.pdf'
const REMOVED = 'tour@xtra.co.il'
const OUT = '.design/tourism-2026'

async function render(pdf: string, png: string) {
  // macOS renders the first page; enough for a one-page agreement.
  execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', png], { stdio: 'ignore' })
  return sharp(png).raw().toBuffer({ resolveWithObject: true })
}

async function main() {
  let failures = 0
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!ok) failures++
  }

  const [textA, textB] = await Promise.all([extractPdfText(readFileSync(ORIGINAL)), extractPdfText(readFileSync(DIGITAL))])
  check('original carries the paper-route line', textA.includes(REMOVED))
  check('digital copy does not', !textB.includes(REMOVED) && !textB.includes('לשלוח למייל'))
  const strip = (t: string) => t.replace(/יש למלא[\s\S]*?tour@xtra\.co\.il/, '').replace(/\s+/g, '')
  check('every other character is identical', strip(textA) === strip(textB), `${strip(textA).length} vs ${strip(textB).length} chars`)

  const [docA, docB] = await Promise.all([PDFDocument.load(readFileSync(ORIGINAL)), PDFDocument.load(readFileSync(DIGITAL))])
  const fieldsA = docA.getForm().getFields().map((f) => `${f.getName()}:${JSON.stringify(f.acroField.getWidgets()[0].getRectangle())}`)
  const fieldsB = docB.getForm().getFields().map((f) => `${f.getName()}:${JSON.stringify(f.acroField.getWidgets()[0].getRectangle())}`)
  check('same form fields at the same places', JSON.stringify(fieldsA) === JSON.stringify(fieldsB))
  check('same page size', JSON.stringify(docA.getPage(0).getSize()) === JSON.stringify(docB.getPage(0).getSize()))

  const a = await render(ORIGINAL, `${OUT}/agreement-original.png`)
  const b = await render(DIGITAL, `${OUT}/agreement-digital.png`)
  check('same rendered size', a.info.width === b.info.width && a.info.height === b.info.height)
  const { width, height, channels } = a.info
  let outside = 0
  let inside = 0
  const footerTop = Math.round(height * 0.94) // the removed line sits at ~95.7% of the page height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      if (d > 30) {
        if (y >= footerTop) inside++
        else outside++
      }
    }
  }
  check('rendered pixels differ only in the footer band', outside === 0, `${outside} pixels differ above it, ${inside} in it`)
  check('the footer band did change (the line is gone)', inside > 100, `${inside} pixels`)

  console.log(failures === 0 ? 'AGREEMENT COPY VERIFIED' : `${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
