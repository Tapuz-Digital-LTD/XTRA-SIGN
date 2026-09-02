import { eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { renderCanvasDocument } from '@/server/documents/canvas-render'
import { processDocumentVersion } from '@/server/documents/process-document'
import { saveFields } from '@/server/documents/save-fields'
import { uploadDocument } from '@/server/documents/upload-document'
import { log } from '@/server/log'
import {
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  type CanvasDocument,
  type CanvasElement,
  type CanvasPage,
} from '@/lib/canvas/model'
import { FIELD_TYPES, type FieldType } from '@/lib/fields'

/**
 * Saving a canvas document: validate, render, file, place the fields.
 *
 * The model arrives from a browser, so none of it is trusted. Every coordinate
 * is checked to be a number on the page and every element to be a kind we
 * render — an unchecked model would become unchecked CSS in a PDF, and an
 * element parked at a nonsense coordinate would put a signature box somewhere
 * nobody chose.
 */

const MAX_PAGES = 40
const MAX_ELEMENTS_PER_PAGE = 300
const MAX_TEXT = 20_000
/** A data URI for a photograph, with room to spare. */
const MAX_IMAGE_SRC = 8 * 1024 * 1024

const FIELD_KINDS = new Set<FieldType>(FIELD_TYPES.map((field) => field.type as FieldType))

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(parsed, min), max)
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * Images must travel inside the document.
 *
 * A remote URL is refused outright rather than fetched. The renderer aborts
 * every request that is not a data URI, so a remote image would show in the
 * editor and then be missing from the signed PDF — and accepting one would put
 * a server-side fetch of an author-supplied address one config change away,
 * which is how an internal network gets read from the outside.
 *
 * Anything a person adds is inlined by the client before it is sent.
 */
function safeImageSrc(value: unknown): string | null {
  const src = typeof value === 'string' ? value : ''
  if (src.length > MAX_IMAGE_SRC) return null
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null
}

function parseElement(raw: unknown, index: number): CanvasElement | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const kind = value.kind

  const base = {
    id: text(value.id, 64) || `el${index}`,
    x: num(value.x, 0, 0, PAGE_WIDTH_MM),
    y: num(value.y, 0, 0, PAGE_HEIGHT_MM),
    width: num(value.width, 40, 1, PAGE_WIDTH_MM),
    height: num(value.height, 10, 1, PAGE_HEIGHT_MM),
    rotation: num(value.rotation, 0, -360, 360),
    zIndex: num(value.zIndex, index, 0, 10_000),
    locked: value.locked === true,
    hidden: value.hidden === true,
    name: text(value.name, 120) || undefined,
  }

  // Styles pass through: every property is sanitised again by the renderer,
  // which is the only place they become CSS.
  const style = (value.style ?? undefined) as never

  switch (kind) {
    case 'text':
      return { ...base, kind: 'text', text: text(value.text), style, binding: value.binding as never }
    case 'image': {
      const src = safeImageSrc(value.src)
      return src ? { ...base, kind: 'image', src, alt: text(value.alt, 200), fit: value.fit === 'contain' ? 'contain' : 'cover', style } : null
    }
    case 'rect':
      return { ...base, kind: 'rect', style }
    case 'line':
      return { ...base, kind: 'line', style }
    case 'table': {
      const headers = Array.isArray(value.headers)
        ? value.headers.slice(0, 20).map((header) => text(header, 200))
        : []
      const rows = Array.isArray(value.rows)
        ? value.rows.slice(0, 200).map((row) =>
            Array.isArray(row) ? row.slice(0, 20).map((cell) => text(cell, 500)) : [],
          )
        : []
      return { ...base, kind: 'table', headers, rows, style }
    }
    case 'field': {
      const fieldType = value.fieldType as FieldType
      if (!FIELD_KINDS.has(fieldType)) return null
      return {
        ...base,
        kind: 'field',
        fieldType,
        label: text(value.label, 120) || 'שדה',
        required: value.required !== false,
        binding: value.binding as never,
        style,
      }
    }
    default:
      return null
  }
}

export function parseCanvasDocument(raw: unknown): CanvasDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.pages) || value.pages.length === 0) return null

  const pages: CanvasPage[] = value.pages.slice(0, MAX_PAGES).map((rawPage, pageIndex) => {
    const page = (rawPage ?? {}) as Record<string, unknown>
    const background = (page.background ?? undefined) as CanvasPage['background']
    const elements = Array.isArray(page.elements)
      ? page.elements
          .slice(0, MAX_ELEMENTS_PER_PAGE)
          .map((element, index) => parseElement(element, index))
          .filter((element): element is CanvasElement => element !== null)
      : []

    return { id: text(page.id, 64) || `p${pageIndex}`, background, elements }
  })

  return { version: 1, title: text(value.title, 200) || 'מסמך', pages }
}

export type CanvasSaveResult =
  | { ok: true; agreementId: string; fields: number }
  | { ok: false; message: string }

export async function saveCanvasDocument(input: {
  session: StaffSession
  title: string
  document: CanvasDocument
  companyId: string
  ip?: string | null
  userAgent?: string | null
}): Promise<CanvasSaveResult> {
  const title = input.title.trim().slice(0, 200)
  if (!title) return { ok: false, message: 'יש להזין שם למסמך.' }
  if (!input.companyId) return { ok: false, message: 'יש לבחור ספק או לקוח.' }

  let rendered
  try {
    rendered = await renderCanvasDocument(input.document)
  } catch (error) {
    log.error('canvas render failed', { error: String(error) })
    return { ok: false, message: 'יצירת ה-PDF נכשלה. נסו שוב.' }
  }

  const uploaded = await uploadDocument({
    session: input.session,
    buffer: rendered.pdf,
    filename: `${title}.pdf`,
    companyId: input.companyId,
    sourceKind: 'composed',
    origin: { composed: true },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
  if (!uploaded.ok) return { ok: false, message: uploaded.message }

  const processed = await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: input.session.organizationId,
    versionId: uploaded.versionId,
    actor: input.session.email,
  })
  if (!processed.ok) return { ok: false, message: processed.message }

  // The design is kept beside the rendered PDF so the document can be reopened
  // and edited rather than rebuilt from scratch.
  await getDb()
    .update(schema.agreements)
    .set({ canvasDocument: input.document })
    .where(eq(schema.agreements.id, uploaded.agreementId))

  if (rendered.fields.length > 0) {
    const saved = await saveFields({
      session: input.session,
      agreementId: uploaded.agreementId,
      fields: rendered.fields,
    })
    if (!saved.ok) {
      return { ok: false, message: `המסמך נוצר, אך השדות לא נשמרו: ${saved.message}` }
    }
  }

  return { ok: true, agreementId: uploaded.agreementId, fields: rendered.fields.length }
}
