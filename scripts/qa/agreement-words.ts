import { readFileSync } from 'node:fs'

/**
 * The form is the agreement, word for word. This reads every Hebrew sentence
 * the joining form and its terms show (JSX text and string literals of 25+
 * characters) and looks for each one in the text layer of the Ministry's PDF.
 * Spacing, quotes and bracket shapes are ignored — the words are not.
 *
 * The Ministry's file is a picture: each page is one raster image, and the
 * text layer over it is copied from the edition before, so what can be
 * extracted may lag behind what is printed (the 2026-09-16 edition changed
 * three regions lines and the extension clause in the picture only). A
 * sentence the picture carries and the layer does not is listed in BY_EYE,
 * with the date it was read off the rendered page.
 *
 *   npx tsx scripts/qa/agreement-words.ts [path/to/agreement.pdf]
 */

const PDF = process.argv[2] ?? '.design/tourism-2026/agreement-v2.pdf'
const SOURCES = ['src/app/[slug]/JoinAndSign.tsx', 'src/app/[slug]/AgreementText.tsx', 'src/lib/self-service-registration.ts']
/** Printed on the page, absent from its text layer — confirmed on the rendered page 2, 2026-09-16. */
const BY_EYE = [
  'צפון, גליל, רמת הגולן וחיפה',
  'אשדוד, אשקלון, ים המלח, אילת וערבה',
  'מרכז, כרמל עד יבנה והשפלה',
  'הרחבה אופציונלית: במידה ובית העסק יבחר בכך (על פי שיקול דעתו הבלעדי), יורשה להעניק את ההטבה, לאורך כל שבוע התיירות האזורי.',
  // The September 2026 edition moved page 1 down by 145pt and its stale text
  // layer's last line fell off the page; the picture still prints it at the foot
  // of page 1 — confirmed on the rendered page, 2026-09-23.
  'קוד קופון על פי קופת בית העסק',
]
/** The system's own sentences: about the form, not from the document. */
const OURS = [/^הצטרפות ל/, /^שני שלבים/, /^הפרטים נשמרו/, /^מולא לפי/, /^אם העסק פועל/, /^אליו יישלח/, /^חתימת מורשה/, /^לאחר החתימה/, /^אני מאשר/, /לשינוי פרטים/, /^לדוגמה/, /^מה שמילאתם/, /^יש ל/, /^אין כרגע/, /^לא הצלחנו/, /^הקוד/, /^ההרשמה שלכם/, /^סביבת בדיקה/, /נכשל/]

const squash = (t: string) => t.replace(/&quot;|&#39;/g, '').replace(/[\s"'“”„״׳()\[\]{}:;,.·\u200e\u200f-]|־/g, '')

async function pdfText(): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(PDF)), useSystemFonts: false })
  const doc = await task.promise
  let out = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    out += content.items.map((it) => ('str' in it ? it.str : '')).join('')
  }
  await task.destroy()
  return squash(out)
}

function sentences(): string[] {
  const found = new Set<string>()
  for (const file of SOURCES) {
    const src = readFileSync(file, 'utf8')
    // JSX text between tags, and string literals.
    for (const m of src.matchAll(/>([^<>{}]*[\u0590-\u05ff][^<>{}]*)</g)) found.add(m[1].trim())
    for (const m of src.matchAll(/'([^'\n]*[\u0590-\u05ff][^'\n]*)'/g)) found.add(m[1].trim())
  }
  // Template-literal fragments are not sentences.
  return [...found].filter((t) => t.length >= 25 && !/[$`{}?]/.test(t) && !OURS.some((re) => re.test(t)))
}

async function main() {
  const haystack = await pdfText()
  let missing = 0
  for (const sentence of sentences()) {
    const whole = haystack.includes(squash(sentence))
    // A printed line can be stored as several items in another order (a
    // heading and its date); then every part must be there on its own.
    const parts = sentence.split(/\s[-–—:]\s/).map(squash).filter(Boolean)
    const byParts = !whole && parts.length > 1 && parts.every((part) => haystack.includes(part))
    const byEye = !whole && !byParts && BY_EYE.some((line) => squash(line) === squash(sentence))
    if (!whole && !byParts && !byEye) missing++
    console.log(`${whole ? '✓' : byParts ? '✓ (in parts)' : byEye ? '✓ (by eye)' : '✗'} ${sentence.slice(0, 90)}${sentence.length > 90 ? '…' : ''}`)
  }
  console.log(missing === 0 ? '\nevery sentence of the form is in the document' : `\n${missing} sentence(s) not found in ${PDF} — the text layer can be older than the picture: check the rendered page before trusting either`)
  process.exit(missing === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
