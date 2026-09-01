import fontkit from '@pdf-lib/fontkit'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { toPdfRect } from '@/lib/fields'
import { shapeForPdf } from './pdf-text'

/**
 * Produces the final signed PDF.
 *
 * Field values and the signature are drawn onto the rendered PDF at the exact
 * points the fractions resolve to on each page's own measured size — never an
 * assumed page shape.
 */

const FONT_PATH = join(process.cwd(), 'src/server/signing/assets/Assistant-Regular.ttf')

export type StampField = {
  type: string
  label: string
  value: string | null
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type StampPage = { pageNumber: number; widthPt: number; heightPt: number }

export type CertificateInput = {
  agreementId: string
  title: string
  signerName: string
  signerEmail: string | null
  signerPhoneMasked: string | null
  verificationMethod: string
  verifiedAt: Date | null
  signedAt: Date
  renderedHash: string
  events: { type: string; at: Date }[]
}

const EVENT_LABELS: Record<string, string> = {
  created: 'המסמך נוצר',
  document_generated: 'המסמך הוכן',
  sent: 'המסמך נשלח',
  email_sent: 'נשלח באימייל',
  sms_sent: 'נשלח ב-SMS',
  viewed: 'המסמך נצפה',
  otp_sent: 'נשלח קוד אימות',
  otp_verified: 'הטלפון אומת',
  signature_applied: 'החתימה הוחלה',
  completed: 'החתימה הושלמה',
}

export async function buildSignedPdf(input: {
  renderedPdf: Buffer
  fields: StampField[]
  pages: StampPage[]
  signatureImage: Buffer
  certificate: CertificateInput
}): Promise<Buffer> {
  const pdf = await PDFDocument.load(input.renderedPdf)
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await readFile(FONT_PATH), { subset: true })

  const signature = await pdf.embedPng(input.signatureImage)
  const docPages = pdf.getPages()

  for (const field of input.fields) {
    const geometry = input.pages.find((p) => p.pageNumber === field.page)
    const page = docPages[field.page - 1]
    if (!geometry || !page) continue

    const rect = toPdfRect(field, geometry)

    if (field.type === 'signature') {
      // Fitted inside the box, keeping the drawn aspect ratio so a signature is
      // never stretched.
      const scale = Math.min(rect.width / signature.width, rect.height / signature.height)
      const w = signature.width * scale
      const h = signature.height * scale
      page.drawImage(signature, {
        x: rect.x + (rect.width - w) / 2,
        y: rect.y + (rect.height - h) / 2,
        width: w,
        height: h,
      })
      continue
    }

    const value = field.type === 'checkbox' ? (field.value === 'true' ? '✓' : '') : (field.value ?? '')
    if (!value.trim()) continue

    // Size to the box, floored so a tall narrow field stays readable.
    const size = Math.max(7, Math.min(rect.height * 0.7, 14))
    drawRtlText(page, font, value, {
      // RTL: text starts at the box's right edge and runs leftwards.
      right: rect.x + rect.width - 2,
      y: rect.y + (rect.height - size) / 2 + size * 0.2,
      size,
    })
  }

  await appendCertificate(pdf, font, input.certificate)

  return Buffer.from(await pdf.save())
}

/**
 * Draws right-aligned text.
 *
 * The x pdf-lib wants is the left edge, so the width is measured first and
 * subtracted — otherwise every Hebrew value would start at the left of its box
 * and run off the right.
 */
function drawRtlText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: { right: number; y: number; size: number; color?: ReturnType<typeof rgb> },
) {
  const shaped = shapeForPdf(text)
  const width = font.widthOfTextAtSize(shaped, opts.size)
  page.drawText(shaped, {
    x: opts.right - width,
    y: opts.y,
    size: opts.size,
    font,
    color: opts.color ?? rgb(0.06, 0.09, 0.16),
  })
}

/**
 * The signature certificate, appended as a final page.
 *
 * Deliberately factual. It records what happened and does not describe the
 * signature as "certified", "qualified" or any other term implying an
 * accreditation this system does not have.
 */
async function appendCertificate(
  pdf: PDFDocument,
  font: PDFFont,
  cert: CertificateInput,
): Promise<void> {
  const page = pdf.addPage([595.276, 841.89])
  const right = 535
  let y = 780

  const line = (text: string, size = 11, gap = 20, color?: ReturnType<typeof rgb>) => {
    drawRtlText(page, font, text, { right, y, size, color })
    y -= gap
  }

  const muted = rgb(0.39, 0.45, 0.55)

  line('אישור חתימה', 20, 34)
  line(cert.title, 13, 30, muted)

  const rows: [string, string][] = [
    ['מזהה מסמך', cert.agreementId],
    ['שם החותם', cert.signerName],
    ['אימייל', cert.signerEmail ?? '—'],
    ['טלפון', cert.signerPhoneMasked ?? '—'],
    ['אופן האימות', cert.verificationMethod],
    ['זמן האימות', cert.verifiedAt ? formatDate(cert.verifiedAt) : '—'],
    ['זמן החתימה', formatDate(cert.signedAt)],
  ]

  for (const [label, value] of rows) {
    drawRtlText(page, font, label, { right, y, size: 10, color: muted })
    drawRtlText(page, font, value, { right: right - 130, y, size: 11 })
    y -= 20
  }

  y -= 6
  // No parentheses: a mirrored bracket pair renders on the wrong sides in an
  // RTL run, which reads as a typo on a legal document.
  line('טביעת המסמך · SHA-256', 10, 16, muted)
  // Split so a 64-character digest fits the page width.
  line(cert.renderedHash.slice(0, 32), 9, 13)
  line(cert.renderedHash.slice(32), 9, 26)

  line('היסטוריית המסמך', 12, 22)
  for (const event of cert.events) {
    const label = EVENT_LABELS[event.type]
    if (!label) continue
    drawRtlText(page, font, label, { right, y, size: 10 })
    drawRtlText(page, font, formatDate(event.at), { right: right - 200, y, size: 9, color: muted })
    y -= 16
    if (y < 60) break
  }

  drawRtlText(page, font, 'הופק על ידי XTRA Sign', {
    right,
    y: 40,
    size: 9,
    color: muted,
  })
}

/** UTC, stated as such — a timestamp with no zone is not a record. */
function formatDate(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`
}
