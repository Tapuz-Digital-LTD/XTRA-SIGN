import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import puppeteer from 'puppeteer-core'
import {
  BENEFIT18_BANK_CLAUSE,
  BENEFIT18_BENEFIT_CLAUSE,
  BENEFIT18_JOIN_CLAUSE,
  BENEFIT18_PRICES_NOTE,
  BENEFIT18_SUBTITLE,
  BENEFIT18_TERMS,
  BENEFIT18_TITLE,
  BENEFIT18_VOUCHER_NOTE,
} from '../../src/lib/benefit18'
import { DECLARE_INSURANCE_TEXT, DECLARE_LICENSE_TEXT, EXTENSION_CLAUSE, REGISTRATION_LABELS, TOURISM_WEEKS, WEEK_CLAUSE, WEEK_LEGEND } from '../../src/lib/self-service-registration'
import { renderPdf } from '../qa/render-pdf'

/**
 * The הטבת 18 ₪ agreement as printed pages, A4, on the campaign's letterhead
 * (the same band as the regular agreement), with an empty box wherever the
 * business answers. It says what the joining form says, in the form's order,
 * and nothing more.
 *
 * One HTML, two outputs, always regenerated together:
 *   src/server/self-service/assets/benefit18.pdf   the pages
 *   src/server/self-service/benefit18-layout.ts    where each box is
 *
 * The boxes are measured off the same layout that printed the PDF, as page
 * fractions — what XTRA Sign's fields are — so the answers stamped at signing
 * sit in their boxes. A page whose text overflows fails the run.
 *
 *   npx tsx scripts/design/benefit18.ts
 *
 * Needs Chrome and Google Fonts (Assistant), like tourism-og.ts.
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SCRATCH = process.env.SCRATCH ?? '/private/tmp'
const PDF_OUT = 'src/server/self-service/assets/benefit18.pdf'
const LAYOUT_OUT = 'src/server/self-service/benefit18-layout.ts'
const PAGES = 2

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The campaign's letterhead, as the regular agreement prints it: the top band
 * of the Ministry's own page (the campaign's mark, בנדה, XTRA), cut from it.
 */
async function campaignBand(): Promise<string> {
  const SCALE = 3
  const [first] = await renderPdf(readFileSync('.design/tourism-2026/agreement-v2.pdf'), SCALE)
  const [top, bottom] = [14 * SCALE, 132 * SCALE]
  const canvas = createCanvas(first.width, bottom - top)
  canvas.getContext('2d').drawImage(await loadImage(first.png), 0, -top)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

/** An answer's place: a box, measured. */
const slot = (key: string, cls = '') => `<span class="slot ${cls}" data-slot="${key}"></span>`
const box = (key: string) => `<span class="box" data-slot="${key}"></span>`
const field = (label: string, key: string, cls = '') => `<div class="ag-field ${cls}"><div class="ag-lbl">${esc(label)}</div>${slot(key, 'ag-box')}</div>`
const bar = (title: string) => `<h3 class="ag-bar">${esc(title)}</h3>`
const tick = (key: string, text: string) => `<div class="ag-tick">${box(key)}<span>${esc(text)}</span></div>`

function page(n: number, band: string, body: string): string {
  return `<div class="page">
  <img class="ag-band" src="${band}" alt="">
  <main class="ag-body">${body}</main>
  <footer class="ag-foot"><span>${esc(BENEFIT18_TITLE)}</span><span>עמוד ${n} מתוך ${PAGES}</span></footer>
</div>`
}

const page1 = `
  <h1 class="ag-title">${esc(BENEFIT18_TITLE)}</h1>
  <p class="ag-sub">${esc(BENEFIT18_SUBTITLE)}</p>
  ${bar('פרטי בית העסק')}
  <div class="ag-panel ag-grid">
    ${field(REGISTRATION_LABELS.businessName, 'a_business_name')}${field(REGISTRATION_LABELS.taxId, 'a_tax_id')}
    ${field(REGISTRATION_LABELS.commercialName, 'a_commercial')}${field(REGISTRATION_LABELS.email, 'a_email')}
    ${field('איש קשר + מס׳ טלפון', 'a_contact_phone')}${field('כתובת', 'a_address')}
  </div>
  <p class="ag-p">${esc(BENEFIT18_JOIN_CLAUSE)}</p>
  ${bar('פרטי ההטבה')}
  <p class="ag-p">${esc(BENEFIT18_BENEFIT_CLAUSE)}</p>
  <table class="ag-table">
    <colgroup><col class="ag-c-n"><col class="ag-c-type"><col class="ag-c-price"><col class="ag-c-price"></colgroup>
    <thead><tr><th></th><th>סוג ההטבה</th><th>מחיר לטובת חודש התיירות</th><th>מחיר קבוע באתר</th></tr></thead>
    <tbody>${[1, 2, 3].map((n) => `<tr><td class="n">${n}.</td><td>${slot(`a_s${n}_type`, 'cell')}</td><td>${slot(`a_s${n}_tourism`, 'cell')}</td><td>${slot(`a_s${n}_site`, 'cell')}</td></tr>`).join('')}</tbody>
  </table>
  <p class="ag-small">${esc(BENEFIT18_PRICES_NOTE)}</p>
  ${field(REGISTRATION_LABELS.benefitNotes, 'a_notes', 'ag-wide')}
  <div class="ag-note">${BENEFIT18_VOUCHER_NOTE.map((t) => `<p>${esc(t).replace(/xtra/g, '<bdi>xtra</bdi>')}</p>`).join('')}</div>
  ${bar('תקופת ההתחייבות')}
  <p class="ag-p">${esc(WEEK_CLAUSE)}</p>
  <p class="ag-legend">${esc(WEEK_LEGEND)}</p>
  <div class="ag-weeks">${TOURISM_WEEKS.map((w) => `<div class="ag-week">${box(`a_${w.id}`)}<div><div class="ag-week-head"><b>${esc(w.title)}</b><span class="ag-dates">${esc(w.dates)}</span></div><div class="ag-regions">${esc(w.regions)}</div></div></div>`).join('')}</div>
  ${tick('a_extension', EXTENSION_CLAUSE)}`

const page2 = `
  ${bar('פרטי חשבון הבנק')}
  <p class="ag-p">${esc(BENEFIT18_BANK_CLAUSE)}</p>
  <div class="ag-grid">
    ${field(REGISTRATION_LABELS.bankAccountName, 'a_bank_account_name')}${field('הבנק', 'a_bank')}
    ${field(REGISTRATION_LABELS.bankBranch, 'a_bank_branch')}${field(REGISTRATION_LABELS.bankBranchName, 'a_bank_branch_name')}
    ${field(REGISTRATION_LABELS.bankAccount, 'a_bank_account')}
  </div>
  ${bar('תנאים והגבלות למימוש ההטבה')}
  <ul class="ag-terms">${BENEFIT18_TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  ${bar('הצהרות ואישורים')}
  ${tick('a_declare_license', DECLARE_LICENSE_TEXT)}
  ${tick('a_declare_insurance', DECLARE_INSURANCE_TEXT)}
  ${bar('חתימת בית העסק')}
  <div class="ag-grid">
    ${field(REGISTRATION_LABELS.signatoryName, 'a_signatory')}${field(REGISTRATION_LABELS.signatoryRole, 'a_role')}
    <div class="ag-field"><div class="ag-lbl">חתימה</div><div class="ag-sigbox" data-slot="a_signature"></div></div>${field('תאריך', 'a_date')}
  </div>`

function buildHtml(band: string): string {
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&display=block" rel="stylesheet">
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box }
  html, body { margin: 0; padding: 0 }
  body { font-family: Assistant, sans-serif; color: #23262a; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: lining-nums }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; break-after: page }
  .page:last-child { break-after: auto }
  p { margin: 0 }

  /* The regular agreement's language — teal accent, light bars and panels, boxed answers. */
  .ag-band { position: absolute; top: 4.94mm; left: 0; width: 210mm }
  .ag-body { position: absolute; top: 46.5mm; left: 16mm; right: 16mm; bottom: 15mm; overflow: hidden; border-top: .6pt solid #dbe3e6; font-size: 9.6pt; line-height: 1.45 }
  .ag-foot { position: absolute; left: 16mm; right: 16mm; bottom: 7mm; display: flex; justify-content: space-between; font-size: 7.4pt; color: #6b7075 }
  .ag-title { margin: 3.4mm 0 .6mm; text-align: center; font-size: 15pt; font-weight: 700 }
  .ag-sub { margin: 0 0 2.6mm; text-align: center; font-size: 10.4pt; font-weight: 700; color: #1599a6 }
  .ag-bar { margin: 3.2mm 0 2mm; padding: 1.3mm 3mm; border-radius: 2.2mm; background: #f5f8f9; border-inline-start: 1.2mm solid #1599a6; font-size: 10.4pt; font-weight: 700 }
  .ag-panel { padding: 2.6mm 3.4mm 3mm; border-radius: 2.2mm; background: #f5f8f9 }
  .ag-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.8mm 6mm }
  .ag-lbl { margin-bottom: .6mm; font-size: 7.4pt; font-weight: 700; color: #575a5d }
  .ag-box { display: block; height: 6.2mm; border: .75pt solid #c6d2d6; border-radius: .8mm; background: #fff }
  .ag-wide { margin-top: 2mm }
  .ag-p { margin: 1.8mm 0; text-align: justify }
  .ag-small { margin: .8mm 0 0; font-size: 7.8pt; color: #575a5d }
  .ag-legend { margin: 1.4mm 0 1.6mm; font-size: 9pt; font-weight: 700; color: #1599a6 }
  .ag-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 1.6mm }
  .ag-table th, .ag-table td { border: .6pt solid #c6d2d6; padding: 0 2mm; text-align: right; vertical-align: middle }
  .ag-table th { height: 6.4mm; background: #f5f8f9; font-size: 8.4pt; font-weight: 700 }
  .ag-table td { height: 7.6mm }
  .ag-table td.n { text-align: center; color: #575a5d; font-size: 8.4pt }
  .ag-c-n { width: 6% } .ag-c-type { width: 46% } .ag-c-price { width: 24% }
  .slot.cell { display: block; width: 100%; height: 20px }
  .ag-note { margin-top: 2.4mm; padding: 2mm 3mm; border-radius: 2.2mm; background: #f5f8f9; border-inline-start: 1.2mm solid #1599a6; font-size: 9pt }
  .ag-note p + p { margin-top: 1mm }
  .ag-weeks { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm }
  .ag-week { display: flex; gap: 2mm; align-items: flex-start; padding: 2mm 2.4mm; border: .75pt solid #c6d2d6; border-radius: 2mm }
  .ag-week > div { flex: 1; min-width: 0 }
  .ag-week-head { display: flex; justify-content: space-between; gap: 2mm; color: #1599a6 }
  .ag-dates { font-weight: 700; direction: ltr }
  .ag-regions { font-size: 8.2pt; color: #3d4146 }
  .box { display: inline-block; flex: 0 0 auto; width: 15px; height: 15px; margin-top: .6mm; border: .8pt solid #4a4e54; border-radius: 1px }
  .ag-tick { display: flex; gap: 2.4mm; align-items: flex-start; margin: 2.4mm 0 }
  .ag-terms { margin: 0; padding-inline-start: 5mm }
  .ag-sigbox { height: 16mm; border: .75pt solid #c6d2d6; border-radius: .8mm; background: #fff }
</style></head><body>
${page(1, band, page1)}
${page(2, band, page2)}
</body></html>`
}

type Measured = { slots: Record<string, { page: number; x: number; y: number; w: number; h: number }>; overflow: number[] }

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const tab = await browser.newPage()
  await tab.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
  await tab.emulateMediaType('print')
  writeFileSync(`${SCRATCH}/benefit18.html`, buildHtml(await campaignBand()))
  await tab.goto(`file://${SCRATCH}/benefit18.html`, { waitUntil: 'networkidle0' })
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
      const body = pg.querySelector('.ag-body')
      return body.scrollHeight > body.clientHeight + 1 ? i + 1 : 0
    }).filter(Boolean)
    return { slots, overflow }
  })()`)) as Measured
  if (measured.overflow.length) throw new Error(`text overflows page(s) ${measured.overflow.join(', ')} — tighten the layout`)

  // Previews of the empty pages, for a person to look at.
  const shots = await tab.$$('.page')
  for (const [i, el] of shots.entries()) await el.screenshot({ path: `${SCRATCH}/benefit18-${i + 1}.png` })

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
 * Where the הטבת 18 ₪ agreement's answers go: their page and page fractions,
 * origin top-left, measured by scripts/design/benefit18.ts off the same
 * layout that printed assets/benefit18.pdf. Generated — do not edit by hand;
 * regenerate the two together.
 */
export const BENEFIT18_PAGES = ${PAGES}

export const BENEFIT18_SLOTS = {
${lines.join('\n')}
} as const

export type Benefit18Slot = keyof typeof BENEFIT18_SLOTS
`,
  )
  console.log(`${PDF_OUT} (${pdf.length} bytes, ${PAGES} pages) · ${LAYOUT_OUT} (${lines.length} boxes) · previews in ${SCRATCH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
