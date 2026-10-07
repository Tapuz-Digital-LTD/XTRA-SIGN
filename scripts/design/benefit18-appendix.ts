import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import puppeteer from 'puppeteer-core'
import {
  APPENDIX_ACCOUNTING,
  APPENDIX_AUDIENCES,
  APPENDIX_FOOTER,
  APPENDIX_HEADING,
  APPENDIX_INTRO,
  APPENDIX_JOINING,
  APPENDIX_PARTY,
  APPENDIX_SECTIONS,
  APPENDIX_SERVICE_CLAUSE,
  APPENDIX_SERVICE_ROWS,
  APPENDIX_SUBJECT,
  APPENDIX_TABLE_HEADINGS,
  ITEM_LETTERS,
  type AppendixSection,
} from '../../src/lib/benefit18-appendix'

/**
 * The 18 ₪ appendix as printed pages: the Tapuznet supplier agreement on the
 * XTRA letterhead, A4, with an empty box wherever the business answers.
 *
 * One HTML, two outputs, always regenerated together:
 *   src/server/self-service/assets/benefit18-appendix.pdf   the pages
 *   src/server/self-service/benefit18-appendix-layout.ts    where each box is
 *
 * The boxes are measured off the same layout that printed the PDF, as page
 * fractions — what XTRA Sign's fields are — so the answers stamped at signing
 * sit on their lines. A page whose text overflows fails the run.
 *
 *   npx tsx scripts/design/benefit18-appendix.ts
 *
 * Needs Chrome and Google Fonts (Assistant, Poppins), like tourism-og.ts.
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SCRATCH = process.env.SCRATCH ?? '/private/tmp'
const PDF_OUT = 'src/server/self-service/assets/benefit18-appendix.pdf'
const LAYOUT_OUT = 'src/server/self-service/benefit18-appendix-layout.ts'
const PAGES = 3

const png = (path: string) => `data:image/png;base64,${readFileSync(path).toString('base64')}`

/**
 * The scanned signature, as ink only. The scan is opaque on an off-white
 * paper (251–254), which prints as a grey box on the page: the paper is lifted
 * to white, then white becomes transparency and the ink keeps its colour
 * (colour-to-alpha against white).
 */
async function inkOnly(path: string): Promise<string> {
  const PAPER = 246
  const image = await loadImage(readFileSync(path))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, image.width, image.height)
  const d = pixels.data
  for (let i = 0; i < d.length; i += 4) {
    const rgb = [0, 1, 2].map((k) => Math.min(255, (d[i + k] * 255) / PAPER))
    const alpha = Math.max(...rgb.map((c) => 255 - c)) / 255
    for (let k = 0; k < 3; k++) d[i + k] = alpha > 0 ? Math.round(255 - (255 - rgb[k]) / alpha) : 255
    d[i + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(pixels, 0, 0)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** An answer's place: the line it is written on. */
const slot = (key: string, cls = '') => `<span class="slot ${cls}" data-slot="${key}"></span>`
const box = (key: string) => `<span class="box" data-slot="${key}"></span>`
const labelled = (label: string, key: string, cls = '') => `<span class="pair ${cls}"><span class="lbl">${esc(label)}</span>${slot(key, 'grow')}</span>`

function section(s: AppendixSection): string {
  const lead = s.lead ? ` <span class="lead">${esc(s.lead)}</span>` : ''
  const items = s.items ? `<ol class="items">${s.items.map((t, i) => `<li><span class="m">${ITEM_LETTERS[i]}.</span><span>${esc(t)}</span></li>`).join('')}</ol>` : ''
  const paragraphs = (s.paragraphs ?? []).map((t) => `<p class="para">${esc(t)}</p>`).join('')
  return `<section class="sec"><h3 class="h"><span class="n">${s.n}.</span>${esc(s.title)}${lead}</h3>${items}${paragraphs}</section>`
}

const sections = (from: number, to: number) => APPENDIX_SECTIONS.filter((s) => s.n >= from && s.n <= to).map(section).join('')

function page(n: number, body: string): string {
  return `<div class="page">
  <header class="head">
    <img class="logo" src="${png('public/xtra-logo.png')}" alt="XTRA">
    <div class="gc">GIFTCARD</div>
  </header>
  <main class="body">${body}</main>
  <footer class="foot"><span>${esc(APPENDIX_FOOTER).replace(/(giftcard@xtra\.co\.il|09-7909500|4366238)/g, '<bdi>$1</bdi>')}</span><span class="pg">עמוד ${n} מתוך ${PAGES}</span></footer>
</div>`
}

const rows = Array.from({ length: APPENDIX_SERVICE_ROWS }, (_, i) => {
  const r = `s${i + 1}`
  return `<tr><td>${slot(`${r}_type`, 'cell')}</td><td>${slot(`${r}_details`, 'cell')}</td><td>${slot(`${r}_price`, 'cell')}</td><td>${slot(`${r}_net`, 'cell')}</td></tr>`
}).join('')

const page1 = `
  <h1 class="title">${esc(APPENDIX_HEADING)}</h1>
  <div class="letter">
    <div class="to">
      <div class="to-head">לכבוד</div>
      <div class="line">${slot('letter_name', 'w-to')}</div>
      <div class="line">${slot('letter_address', 'w-to')}</div>
      <div class="line">${slot('letter_city', 'w-to')}</div>
      <div class="line">${labelled('לידי:', 'letter_contact', 'w-to')}</div>
      <div class="line">${labelled('טלפון:', 'letter_phone', 'w-to')}</div>
    </div>
    <div class="date">${labelled('תאריך:', 'letter_date', 'w-date')}</div>
  </div>
  <p class="subject">הנדון: ${esc(APPENDIX_SUBJECT)}</p>
  ${APPENDIX_INTRO.map((t) => `<p class="para">${esc(t)}</p>`).join('')}
  <h3 class="h u">${esc(APPENDIX_JOINING.title)}</h3>
  ${APPENDIX_JOINING.paragraphs.map((t) => `<p class="para">${esc(t)}</p>`).join('')}
  <section class="sec">
    <p class="para clause1"><span class="n">1.</span>${slot('clause_name', 'w-clause')} ${esc(APPENDIX_SERVICE_CLAUSE)}</p>
    <p class="aud">${APPENDIX_AUDIENCES.map((a) => `<span class="choice">${box(`audience_${a.id}`)}${esc(a.label)}</span>`).join('<span class="sep">/</span>')}</p>
    <table class="svc">
      <colgroup><col class="c-type"><col class="c-details"><col class="c-price"><col class="c-net"></colgroup>
      <thead><tr>${APPENDIX_TABLE_HEADINGS.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
  ${sections(2, 3)}`

const page2 = sections(4, 7)

function buildHtml(stamp: string): string {
const page3 = `
  ${sections(8, 10)}
  <section class="acct">
    <h3 class="h u">${esc(APPENDIX_ACCOUNTING.title)}</h3>
    <p class="para strong">${esc(APPENDIX_ACCOUNTING.invoice)}</p>
    <p class="para"><b>כתובת:</b> ${esc(APPENDIX_ACCOUNTING.address)}</p>
    <p class="para"><b>איש קשר הנה״ח:</b> ${esc(APPENDIX_ACCOUNTING.bookkeeper.name)} <bdi>${esc(APPENDIX_ACCOUNTING.bookkeeper.email)}</bdi></p>
    <h4 class="h u">${esc(APPENDIX_ACCOUNTING.businessTitle)}</h4>
    <div class="grid g-business">${labelled('שם החברה:', 'form_company')}${labelled('שם איש קשר:', 'form_contact')}${labelled('ח.פ:', 'form_tax_id')}</div>
    <div class="grid g-one">${labelled('כתובת למשלוח דואר:', 'form_mailing')}</div>
    <h4 class="h u">${esc(APPENDIX_ACCOUNTING.bankTitle)}</h4>
    <div class="grid g-bank">${labelled('שם החשבון:', 'bank_account_name')}${labelled('שם סניף:', 'bank_branch_name')}${labelled('מספר החשבון:', 'bank_account')}</div>
    <div class="grid g-bank">${labelled('שם הבנק:', 'bank_name')}${labelled('מספר סניף:', 'bank_branch')}${labelled('מספר בנק:', 'bank_number')}</div>
    <p class="h closing">${esc(APPENDIX_ACCOUNTING.closing)}</p>
    <div class="grid g-signer">${labelled('שם החותם:', 'signatory_name')}${labelled('תאריך חתימה:', 'sign_date')}</div>
    <div class="signs">
      <div class="sign"><div class="lbl">חתימת בית העסק:</div><div class="sigbox" data-slot="signature"></div></div>
      <div class="sign"><div class="lbl">חתימת ${esc(APPENDIX_PARTY)}:</div><div class="stampbox"><img class="stamp" src="${stamp}" alt=""></div></div>
    </div>
  </section>`

return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Poppins:wght@500&display=block" rel="stylesheet">
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box }
  html, body { margin: 0; padding: 0 }
  body { font-family: Assistant, sans-serif; color: #1d2126; font-size: 10pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: lining-nums }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; padding: 11mm 19mm 0; break-after: page }
  .page:last-child { break-after: auto }

  .head { height: 19mm; text-align: center }
  .logo { height: 7mm; display: block; margin: 0 auto }
  .gc { font: 500 6.4pt/1 Poppins, sans-serif; letter-spacing: .42em; margin-top: 1.4mm; padding-left: .42em; color: #4a4e54 }
  .body { height: 247mm; overflow: hidden }
  .foot { position: absolute; left: 19mm; right: 19mm; bottom: 9mm; display: flex; justify-content: space-between; gap: 6mm;
    border-top: .6pt solid #c4c8cd; padding-top: 2.2mm; font-size: 7.4pt; color: #5c636b }
  .foot .pg { white-space: nowrap }

  .title { font-size: 12pt; font-weight: 700; margin: 0 0 4mm; padding-bottom: 2.2mm; border-bottom: .6pt solid #c4c8cd }
  .letter { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 3mm }
  .to-head { font-weight: 700 }
  .line { height: 6.6mm; display: flex; align-items: flex-end }
  .date { padding-top: 1mm }
  .subject { text-align: center; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; margin: 2mm 0 2.4mm }

  p { margin: 0 }
  .para { text-align: justify; margin-bottom: 1.2mm }
  .strong { font-weight: 700 }
  .h { font-size: 10.2pt; font-weight: 700; margin: 3mm 0 1mm }
  .h.u { text-decoration: underline; text-underline-offset: 2px }
  .h .n { display: inline-block; min-width: 5.2mm }
  .h .lead { font-weight: 400 }
  .sec { break-inside: avoid }
  .items { list-style: none; margin: 0; padding: 0 }
  .items li { display: grid; grid-template-columns: 5.2mm 1fr; text-align: justify; margin-bottom: .8mm }
  .clause1 { margin-top: 3mm; text-align: right; line-height: 7mm }
  .clause1 .n { font-weight: 700; display: inline-block; min-width: 5.2mm }

  .slot { display: inline-block; height: 20px; border-bottom: .7pt solid #8d949c; vertical-align: bottom }
  .slot.cell { display: block; width: 100%; border-bottom: 0 }
  .w-to { width: 62mm }
  .w-date { width: 30mm }
  .w-clause { width: 58mm }
  .pair { display: inline-flex; align-items: flex-end; gap: 1.6mm; min-width: 0 }
  .pair .lbl { white-space: nowrap; padding-bottom: 1px }
  .pair .grow { flex: 1; min-width: 8mm }
  .line .pair { width: 62mm }
  .line .pair .grow { width: auto }
  .date .pair { width: 44mm }

  .aud { margin: 1.4mm 0 2mm; display: flex; align-items: center; gap: 2.4mm }
  .choice { display: inline-flex; align-items: center; gap: 1.6mm }
  .box { display: inline-block; width: 11px; height: 11px; border: .8pt solid #4a4e54; border-radius: 1px }
  .sep { color: #5c636b }

  .svc { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 1mm }
  .svc th, .svc td { border: .6pt solid #9aa1a8; padding: 0 2mm; text-align: right; vertical-align: middle }
  .svc th { height: 7mm; font-weight: 600; font-size: 9pt; background: #f1f2f4 }
  .svc td { height: 9mm }
  .c-type { width: 27% } .c-details { width: 41% } .c-price { width: 15% } .c-net { width: 17% }

  .acct { margin-top: 4.5mm; padding-top: 1mm }
  .grid { display: grid; column-gap: 6mm; margin-bottom: 2.6mm }
  .grid .pair { width: 100% }
  .g-business { grid-template-columns: 1.25fr 1fr .8fr }
  .g-one { grid-template-columns: 1fr }
  .g-bank { grid-template-columns: 1.25fr 1fr 1fr }
  .g-signer { grid-template-columns: 1.3fr 1fr; margin-top: 2mm }
  .closing { margin-top: 4mm }
  .signs { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12mm; margin-top: 3mm }
  .sign .lbl { font-weight: 600; margin-bottom: 1mm }
  .sigbox { width: 64mm; height: 22mm; border-bottom: .7pt solid #8d949c }
  .stampbox { height: 22mm; display: flex; align-items: flex-end }
  .stamp { height: 21mm }
</style></head><body>
${page(1, page1)}
${page(2, page2)}
${page(3, page3)}
</body></html>`
}

type Measured = { slots: Record<string, { page: number; x: number; y: number; w: number; h: number }>; overflow: number[]; pages: number }

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const tab = await browser.newPage()
  await tab.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
  await tab.emulateMediaType('print')
  writeFileSync(`${SCRATCH}/benefit18-appendix.html`, buildHtml(await inkOnly('scripts/design/benefit18/tapuznet-signature.png')))
  await tab.goto(`file://${SCRATCH}/benefit18-appendix.html`, { waitUntil: 'networkidle0' })
  await tab.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await tab.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null))))

  // A string, not a function: tsx's name helpers do not exist inside the page.
  const measured = (await tab.evaluate(`(() => {
    const round = (n) => Math.round(n * 1e5) / 1e5
    const pages = Array.from(document.querySelectorAll('.page'))
    const slots = {}
    pages.forEach((pg, i) => {
      const p = pg.getBoundingClientRect()
      pg.querySelectorAll('[data-slot]').forEach((el) => {
        const r = el.getBoundingClientRect()
        slots[el.dataset.slot] = { page: i + 1, x: round((r.left - p.left) / p.width), y: round((r.top - p.top) / p.height), w: round(r.width / p.width), h: round(r.height / p.height) }
      })
    })
    const overflow = pages.map((pg, i) => {
      const body = pg.querySelector('.body')
      return body.scrollHeight > body.clientHeight + 1 ? i + 1 : 0
    }).filter(Boolean)
    return { slots, overflow, pages: pages.length }
  })()`)) as Measured
  if (measured.overflow.length) throw new Error(`text overflows page(s) ${measured.overflow.join(', ')} — tighten the layout`)

  // Previews of the empty pages, for a person to look at.
  const shots = await tab.$$('.page')
  for (const [i, el] of shots.entries()) await el.screenshot({ path: `${SCRATCH}/benefit18-appendix-${i + 1}.png` })

  const pdf = Buffer.from(await tab.pdf({ preferCSSPageSize: true, printBackground: true }))
  await browser.close()

  const doc = await PDFDocument.load(pdf)
  if (doc.getPageCount() !== PAGES) throw new Error(`expected ${PAGES} pages, Chrome printed ${doc.getPageCount()}`)
  const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
  if (Math.abs(w - 595.28) > 1 || Math.abs(h - 841.89) > 1) throw new Error(`expected A4, got ${w}×${h}pt`)
  writeFileSync(PDF_OUT, pdf)

  const lines = Object.entries(measured.slots).map(([key, s]) => `  ${key}: { page: ${s.page}, x: ${s.x}, y: ${s.y}, w: ${s.w}, h: ${s.h} },`)
  writeFileSync(
    LAYOUT_OUT,
    `/**
 * Where the 18 ₪ appendix's answers go on its pages: page fractions, origin
 * top-left, measured by scripts/design/benefit18-appendix.ts off the same
 * layout that printed assets/benefit18-appendix.pdf. Generated — do not edit
 * by hand; regenerate the two together.
 */
export const APPENDIX_PAGES = ${PAGES}

export const APPENDIX_SLOTS = {
${lines.join('\n')}
} as const

export type AppendixSlot = keyof typeof APPENDIX_SLOTS
`,
  )
  console.log(`${PDF_OUT} (${pdf.length} bytes, ${PAGES} pages) · ${LAYOUT_OUT} (${lines.length} boxes) · previews in ${SCRATCH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
