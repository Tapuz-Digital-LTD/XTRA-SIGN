import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'

/**
 * Proves the digital copy of the agreement differs from the original in
 * exactly two ways and in nothing else: the paper-route line is gone, and the
 * Ministry's two notes are set in the band it used to occupy. Everything
 * above that band — every character, every form field, every pixel — is the
 * document people have already signed.
 *
 *   npx tsx scripts/design/verify-agreement.ts
 */

const ORIGINAL = '.design/tourism-2026/agreement.pdf'
const DIGITAL = '.design/tourism-2026/agreement-digital.pdf'
const REMOVED = 'tour@xtra.co.il'
const OUT = '.design/tourism-2026'
/** The Ministry's additions, as they must read in the signed file. */
const ADDED = [
  'הפעילות במסגרת חודש התיירות הישראלית מסובסדת על ידי משרד התיירות, ואינה מבוססת על הנחות הניתנות על ידי העסקים המשתתפים בלבד.',
  'למידע נוסף על המיזם ולצפייה באתר המקוון של חודש התיירות הישראלית:',
]
const SITE = 'https://israeltourismmonth.co.il/'

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
  const squash = (t: string) => t.replace(/\s+/g, '')
  for (const note of ADDED) check(`digital copy carries the Ministry's note "${note.slice(0, 28)}…"`, squash(textB).includes(squash(note)))
  check('digital copy carries the campaign address', textB.includes(SITE))
  check('the original carried neither', ADDED.every((n) => !squash(textA).includes(squash(n))))
  // Everything else, character for character: the paper-route line out, the
  // two notes and the address in, and nothing else moved.
  const strip = (t: string) =>
    [...ADDED, SITE].reduce((acc, part) => acc.replace(squash(part), ''), squash(t.replace(/יש למלא[\s\S]*?tour@xtra\.co\.il/, '')))
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
  // The band the paper-route line used to occupy, and where the notes are set
  // now: everything below the signature block, which ends at y=149pt from the
  // bottom of an 842pt page.
  const footerTop = Math.round(height * (1 - 100 / 842))
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
  check('rendered pixels differ only in the closing band', outside === 0, `${outside} pixels differ above it, ${inside} in it`)
  check('the closing band did change (line out, notes in)', inside > 100, `${inside} pixels`)

  const links = docB
    .getPage(0)
    .node.Annots()
    ?.asArray()
    .map((ref) => docB.context.lookup(ref))
    .filter((a): a is PDFDict => a instanceof PDFDict)
    .map((a) => (a.lookup(PDFName.of('A')) as PDFDict | undefined)?.get(PDFName.of('URI'))?.toString())
  check('the address is a link in the file', links?.some((u) => u?.includes('israeltourismmonth.co.il')) ?? false)

  console.log(failures === 0 ? 'AGREEMENT COPY VERIFIED' : `${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
