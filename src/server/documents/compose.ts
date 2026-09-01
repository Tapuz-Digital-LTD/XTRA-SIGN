import fontkit from '@pdf-lib/fontkit'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { StaffSession } from '@/server/auth/session'
import { shapeForPdf } from '@/server/signing/pdf-text'
import { LIMITS } from './limits'
import { processDocumentVersion } from './process-document'
import { uploadDocument } from './upload-document'

/**
 * A document written inside the system.
 *
 * The user types a title and the text; this turns it into a PDF and hands that
 * PDF to the exact pipeline an uploaded file goes through. From the editor
 * onwards nothing knows or cares that the document was never a file on
 * someone's disk — fields, recipient, sending, signing and the signed copy are
 * all the same code.
 *
 * The text uses three conventions and nothing else, because someone writing a
 * supplier agreement on a phone should not have to learn a markup language:
 *
 *   # כותרת         a heading
 *   - פריט          a bulleted item ("*" and "•" work too)
 *   ---             a page break
 *
 * A blank line separates paragraphs. Everything else is a paragraph.
 */

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'page_break' }

export const COMPOSE_LIMITS = {
  MAX_TITLE_CHARS: 200,
  MAX_TEXT_CHARS: 20_000,
} as const

export function parseComposedText(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()

    if (line === '') {
      flush()
      continue
    }
    if (/^-{3,}$/.test(line)) {
      flush()
      blocks.push({ type: 'page_break' })
      continue
    }
    if (/^#+\s+/.test(line)) {
      flush()
      blocks.push({ type: 'heading', text: line.replace(/^#+\s+/, '') })
      continue
    }
    if (/^[-*•]\s+/.test(line)) {
      flush()
      blocks.push({ type: 'bullet', text: line.replace(/^[-*•]\s+/, '') })
      continue
    }
    paragraph.push(line)
  }
  flush()

  return blocks
}

// ---- layout ---------------------------------------------------------------

const FONT_PATH = join(process.cwd(), 'src/server/signing/assets/Assistant-Regular.ttf')

/** A4, like the certificate page. Points. */
const PAGE = { width: 595.276, height: 841.89 }
const MARGIN = { top: 64, bottom: 64, side: 56 }
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)

const STYLE = {
  title: { size: 22, lineHeight: 30, after: 18 },
  heading: { size: 14.5, lineHeight: 22, before: 8, after: 4 },
  paragraph: { size: 11.5, lineHeight: 18, after: 8 },
  bullet: { size: 11.5, lineHeight: 18, after: 3, indent: 16 },
} as const

export class ComposeError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage)
  }
}

/**
 * Lays the blocks out onto as many A4 pages as they need.
 *
 * Right-aligned throughout: this is a Hebrew document, and a Latin fragment
 * inside it (a company name, an amount) is handled per line by the same
 * bidi shaping the signed PDF uses. Words are measured unshaped, which is
 * correct because shaping only reorders glyphs and never changes their sum.
 */
export async function renderComposedPdf(input: { title: string; blocks: Block[] }): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await readFile(FONT_PATH), { subset: true })

  const right = PAGE.width - MARGIN.side
  const maxWidth = PAGE.width - MARGIN.side * 2

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height])
  let y = PAGE.height - MARGIN.top

  const newPage = () => {
    if (pdf.getPageCount() >= LIMITS.MAX_PAGES) {
      throw new ComposeError(`המסמך ארוך מדי. ניתן ליצור עד ${LIMITS.MAX_PAGES} עמודים.`)
    }
    page = pdf.addPage([PAGE.width, PAGE.height])
    y = PAGE.height - MARGIN.top
  }

  const ensure = (height: number) => {
    if (y - height < MARGIN.bottom) newPage()
  }

  const drawLines = (
    lines: string[],
    opts: { size: number; lineHeight: number; rightEdge: number; color?: ReturnType<typeof rgb> },
  ) => {
    for (const line of lines) {
      ensure(opts.lineHeight)
      const shaped = shapeForPdf(line)
      const width = font.widthOfTextAtSize(shaped, opts.size)
      page.drawText(shaped, {
        x: opts.rightEdge - width,
        y: y - opts.size,
        size: opts.size,
        font,
        color: opts.color ?? INK,
      })
      y -= opts.lineHeight
    }
  }

  // Title, then a rule under it.
  const title = input.title.trim()
  if (title) {
    drawLines(wrap(font, title, STYLE.title.size, maxWidth), {
      size: STYLE.title.size,
      lineHeight: STYLE.title.lineHeight,
      rightEdge: right,
    })
    y -= 4
    page.drawLine({
      start: { x: MARGIN.side, y },
      end: { x: right, y },
      thickness: 0.6,
      color: rgb(0.89, 0.9, 0.91),
    })
    y -= STYLE.title.after
  }

  for (const block of input.blocks) {
    switch (block.type) {
      case 'page_break':
        newPage()
        break

      case 'heading': {
        // A heading never sits alone at the foot of a page.
        ensure(STYLE.heading.before + STYLE.heading.lineHeight + STYLE.paragraph.lineHeight)
        y -= STYLE.heading.before
        drawLines(wrap(font, block.text, STYLE.heading.size, maxWidth), {
          size: STYLE.heading.size,
          lineHeight: STYLE.heading.lineHeight,
          rightEdge: right,
        })
        y -= STYLE.heading.after
        break
      }

      case 'paragraph':
        drawLines(wrap(font, block.text, STYLE.paragraph.size, maxWidth), {
          size: STYLE.paragraph.size,
          lineHeight: STYLE.paragraph.lineHeight,
          rightEdge: right,
        })
        y -= STYLE.paragraph.after
        break

      case 'bullet': {
        const lines = wrap(font, block.text, STYLE.bullet.size, maxWidth - STYLE.bullet.indent)
        ensure(STYLE.bullet.lineHeight)
        // The dot sits at the margin; the text hangs from the indent, so a
        // wrapped item keeps its lines aligned under the first.
        const dotWidth = font.widthOfTextAtSize('•', STYLE.bullet.size)
        page.drawText('•', {
          x: right - dotWidth,
          y: y - STYLE.bullet.size,
          size: STYLE.bullet.size,
          font,
          color: INK,
        })
        drawLines(lines, {
          size: STYLE.bullet.size,
          lineHeight: STYLE.bullet.lineHeight,
          rightEdge: right - STYLE.bullet.indent,
        })
        y -= STYLE.bullet.after
        break
      }
    }
  }

  // Page numbers, once the count is known.
  const pages = pdf.getPages()
  pages.forEach((p, index) => {
    const label = shapeForPdf(`עמוד ${index + 1} מתוך ${pages.length}`)
    const width = font.widthOfTextAtSize(label, 9)
    p.drawText(label, { x: (PAGE.width - width) / 2, y: 36, size: 9, font, color: MUTED })
  })

  return Buffer.from(await pdf.save())
}

/**
 * Greedy word wrap against the real font metrics. A single word wider than the
 * line is broken by character rather than allowed to run off the page.
 */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''

  const widthOf = (s: string) => font.widthOfTextAtSize(s, size)

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (widthOf(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = ''

    if (widthOf(word) <= maxWidth) {
      current = word
      continue
    }
    // Too wide on its own: break it by character.
    let piece = ''
    for (const ch of word) {
      if (widthOf(piece + ch) > maxWidth && piece) {
        lines.push(piece)
        piece = ''
      }
      piece += ch
    }
    current = piece
  }
  if (current) lines.push(current)

  return lines.length > 0 ? lines : ['']
}

// ---- use-case ---------------------------------------------------------------

export type ComposeResult =
  | { ok: true; agreementId: string; pageCount: number }
  | { ok: false; message: string }

/**
 * Creates a draft agreement from text typed into the composer.
 *
 * Validation happens here, in Hebrew sentences, before any PDF exists. The
 * generated PDF then goes through `uploadDocument` exactly as a file would:
 * same byte check, same storage key, same audit row, same processing.
 */
export async function createComposedDocument(input: {
  session: StaffSession
  title: string
  text: string
  ip?: string | null
  userAgent?: string | null
}): Promise<ComposeResult> {
  const title = input.title.trim().slice(0, COMPOSE_LIMITS.MAX_TITLE_CHARS)
  if (!title) return { ok: false, message: 'יש להזין שם למסמך.' }

  if (input.text.length > COMPOSE_LIMITS.MAX_TEXT_CHARS) {
    return {
      ok: false,
      message: `הטקסט ארוך מדי. ניתן להזין עד ${COMPOSE_LIMITS.MAX_TEXT_CHARS.toLocaleString('he-IL')} תווים.`,
    }
  }

  const blocks = parseComposedText(input.text)
  if (!blocks.some((b) => b.type !== 'page_break')) {
    return { ok: false, message: 'יש להזין את תוכן המסמך.' }
  }

  let pdf: Buffer
  try {
    pdf = await renderComposedPdf({ title, blocks })
  } catch (error) {
    if (error instanceof ComposeError) return { ok: false, message: error.userMessage }
    throw error
  }

  const uploaded = await uploadDocument({
    session: input.session,
    buffer: pdf,
    filename: `${title}.pdf`,
    origin: { composed: true },
    ip: input.ip,
    userAgent: input.userAgent,
  })
  if (!uploaded.ok) return { ok: false, message: uploaded.message }

  const processed = await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: input.session.organizationId,
    versionId: uploaded.versionId,
    actor: input.session.email,
  })
  if (!processed.ok) return { ok: false, message: processed.message }

  return { ok: true, agreementId: uploaded.agreementId, pageCount: processed.pageCount }
}
