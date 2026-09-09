import { readFileSync } from 'node:fs'

/**
 * The form is the agreement, word for word. This reads every Hebrew sentence
 * the joining form and its terms show (JSX text and string literals of 25+
 * characters) and looks for each one in the text layer of the Ministry's PDF.
 * Spacing, quotes and bracket shapes are ignored — the words are not.
 *
 *   npx tsx scripts/qa/agreement-words.ts [path/to/agreement.pdf]
 */

const PDF = process.argv[2] ?? '.design/tourism-2026/agreement-v2.pdf'
const SOURCES = ['src/app/[slug]/JoinAndSign.tsx', 'src/app/[slug]/AgreementText.tsx']
/** The system's own sentences: about the form, not from the document. */
const OURS = [/^ארבעה שלבים/, /^הפרטים נשמרו/, /^מולא לפי/, /^אם העסק פועל/, /^אליו יישלח/, /^חתימת מורשה/, /^לאחר החתימה/, /^אני מאשר/, /לשינוי פרטים/, /^לדוגמה/, /^מה שמילאתם/, /^יש ל/, /^אין כרגע/, /^לא הצלחנו/, /^הקוד/, /^ההרשמה שלכם/, /^סביבת בדיקה/, /נכשל/]

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
    if (!whole && !byParts) missing++
    console.log(`${whole ? '✓' : byParts ? '✓ (in parts)' : '✗'} ${sentence.slice(0, 90)}${sentence.length > 90 ? '…' : ''}`)
  }
  console.log(missing === 0 ? '\nevery sentence of the form is in the document' : `\n${missing} sentence(s) not found in ${PDF}`)
  process.exit(missing === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
