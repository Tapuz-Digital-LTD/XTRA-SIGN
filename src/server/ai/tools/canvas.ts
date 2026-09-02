import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { parseCanvasDocument } from '@/server/documents/canvas-save'
import { getOrganizationProfile } from '@/server/organization/profile'
import type { StaffSession } from '@/server/auth/session'
import {
  emptyDocument,
  findElement,
  newId,
  topZIndex,
  type CanvasDocument,
  type CanvasElement,
} from '@/lib/canvas/model'
import { apply, type AlignMode, type Command } from '@/lib/canvas/store'
import { defineTool, isIdError, requireId, schema as toolSchema, str, strList } from '../registry'

/**
 * Designing on the canvas, through the same commands a person's mouse uses.
 *
 * The assistant edits the document that exists rather than producing a new one:
 * "make the logo bigger and move it to the top right" resolves to one update of
 * one element, so everything else on the page — and every earlier instruction —
 * survives untouched.
 */

const MAX_ELEMENTS_LISTED = 60

async function loadDocument(
  session: StaffSession,
  agreementId: string,
): Promise<CanvasDocument | null> {
  await authorizeAgreementAccess(session, agreementId)
  const [row] = await getDb()
    .select({ canvasDocument: schema.agreements.canvasDocument, title: schema.agreements.title })
    .from(schema.agreements)
    .where(
      and(
        eq(schema.agreements.id, agreementId),
        eq(schema.agreements.organizationId, session.organizationId),
      ),
    )
    .limit(1)

  if (!row?.canvasDocument) return null
  const parsed = parseCanvasDocument(row.canvasDocument)
  return parsed ? { ...parsed, title: row.title } : null
}

/**
 * Writes the model back.
 *
 * The PDF is deliberately not re-rendered here: a draft is edited many times
 * and rendering on every change would be slow and pointless. The document is
 * rendered when it is saved from the editor or sent.
 */
async function storeDocument(
  session: StaffSession,
  agreementId: string,
  document: CanvasDocument,
): Promise<void> {
  await getDb()
    .update(schema.agreements)
    .set({ canvasDocument: document })
    .where(
      and(
        eq(schema.agreements.id, agreementId),
        eq(schema.agreements.organizationId, session.organizationId),
      ),
    )
}

/** Runs commands against a document and saves the result. */
async function edit(
  session: StaffSession,
  agreementId: string,
  commands: Command[],
): Promise<CanvasDocument | null> {
  const document = await loadDocument(session, agreementId)
  if (!document) return null
  const next = commands.reduce(apply, document)
  await storeDocument(session, agreementId, next)
  return next
}

export const getDocumentLayout = defineTool<{ documentId: string }>({
  name: 'get_document_layout',
  description:
    'The pages and elements of a designed document, with every id, position and size in millimetres. Always read this before changing anything, so you edit the element the user means.',
  risk: 'safe',
  input: toolSchema({ documentId: str('The document id') }, ['documentId']),
  async run({ documentId }, { session }) {
    const id = requireId(documentId, 'המסמך')
    if (isIdError(id)) return id

    const document = await loadDocument(session, id)
    if (!document) return { summary: 'המסמך הזה לא נוצר בעורך העיצוב, ולכן אין לו פריסה לערוך.' }

    return {
      summary: `${document.pages.length} עמודים.`,
      target: { type: 'document', id },
      data: {
        kind: 'layout',
        pages: document.pages.map((page, index) => ({
          page: index + 1,
          background: page.background ?? null,
          elements: page.elements.slice(0, MAX_ELEMENTS_LISTED).map((element) => ({
            id: element.id,
            kind: element.kind,
            name: element.name ?? null,
            x: Math.round(element.x * 10) / 10,
            y: Math.round(element.y * 10) / 10,
            width: Math.round(element.width * 10) / 10,
            height: Math.round(element.height * 10) / 10,
            text: element.kind === 'text' ? element.text.slice(0, 120) : undefined,
            fieldType: element.kind === 'field' ? element.fieldType : undefined,
          })),
        })),
      },
    }
  },
})

export const addElement = defineTool<{
  documentId: string
  page: number
  element: Record<string, unknown>
}>({
  name: 'add_element',
  description:
    'Add one element to a page. Positions are millimetres on a 210x297 A4 page, measured from the top-right. Kinds: text, image, rect, line, table, field.',
  risk: 'safe',
  input: toolSchema(
    {
      documentId: str('The document id'),
      page: { type: 'number', description: 'Page number, starting at 1' },
      element: {
        type: 'object',
        description:
          'The element: kind, x, y, width, height, plus text/style for text, headers+rows for table, fieldType+label for field.',
      },
    },
    ['documentId', 'page', 'element'],
  ),
  async run(input, { session }) {
    const id = requireId(input.documentId, 'המסמך')
    if (isIdError(id)) return id

    const document = await loadDocument(session, id)
    if (!document) return { summary: 'המסמך הזה לא נוצר בעורך העיצוב.' }

    const pageIndex = Math.min(Math.max(Math.round(input.page) - 1, 0), document.pages.length - 1)
    // Given an id and a layer here so the model is complete before it is
    // validated; the parser rejects anything else that is wrong.
    const raw = {
      ...input.element,
      id: newId(),
      zIndex: topZIndex(document.pages[pageIndex]),
    }
    const candidate = parseCanvasDocument({
      version: 1,
      title: document.title,
      pages: [{ id: 'tmp', elements: [raw] }],
    })
    const element = candidate?.pages[0]?.elements[0]
    if (!element) return { summary: 'לא הצלחתי להוסיף את האלמנט הזה. נסו לתאר אותו אחרת.' }

    const next = await edit(session, id, [{ type: 'add', pageIndex, element }])
    return next
      ? { summary: `נוסף ${element.kind === 'field' ? 'שדה' : 'אלמנט'} לעמוד ${pageIndex + 1}.`, target: { type: 'document', id }, data: { kind: 'link', href: `/documents/${id}/design`, label: 'פתח בעורך' } }
      : { summary: 'העדכון נכשל.' }
  },
})

export const updateElement = defineTool<{
  documentId: string
  elementId: string
  patch: Record<string, unknown>
}>({
  name: 'update_element',
  description:
    'Change one existing element — move it (x, y), resize it (width, height), or restyle it. Millimetres from the top-right of the page. Use get_document_layout first to find the id.',
  risk: 'safe',
  input: toolSchema(
    {
      documentId: str('The document id'),
      elementId: str('The element id from get_document_layout'),
      patch: { type: 'object', description: 'Only the properties to change' },
    },
    ['documentId', 'elementId', 'patch'],
  ),
  async run(input, { session }) {
    const id = requireId(input.documentId, 'המסמך')
    if (isIdError(id)) return id

    const document = await loadDocument(session, id)
    if (!document) return { summary: 'המסמך הזה לא נוצר בעורך העיצוב.' }
    const found = findElement(document, input.elementId)
    if (!found) return { summary: 'לא מצאתי את האלמנט הזה במסמך.' }

    // Merged then re-parsed, so a patch cannot smuggle in a value the editor
    // itself would never produce.
    const merged = parseCanvasDocument({
      version: 1,
      title: document.title,
      pages: [{ id: 'tmp', elements: [{ ...found.element, ...input.patch, id: found.element.id }] }],
    })
    const element = merged?.pages[0]?.elements[0]
    if (!element) return { summary: 'השינוי הזה אינו חוקי.' }

    const next = await edit(session, id, [
      { type: 'update', elementId: element.id, patch: element as Partial<CanvasElement> },
    ])
    return next
      ? {
          summary: `עודכן: ${element.name ?? element.kind}.`,
          target: { type: 'document', id },
          data: { kind: 'link', href: `/documents/${id}/design`, label: 'פתח בעורך' },
        }
      : { summary: 'העדכון נכשל.' }
  },
})

export const removeElement = defineTool<{ documentId: string; elementIds: string[] }>({
  name: 'delete_element',
  description: 'Remove elements from a designed document.',
  risk: 'confirm',
  input: toolSchema({ documentId: str('The document id'), elementIds: strList('Element ids') }, [
    'documentId',
    'elementIds',
  ]),
  preview: ({ elementIds }) => `מחיקת ${elementIds.length} אלמנטים מהמסמך`,
  async run({ documentId, elementIds }, { session }) {
    const id = requireId(documentId, 'המסמך')
    if (isIdError(id)) return id
    const next = await edit(session, id, [{ type: 'delete', elementIds }])
    return next ? { summary: 'נמחק.', target: { type: 'document', id } } : { summary: 'המחיקה נכשלה.' }
  },
})

export const alignElements = defineTool<{ documentId: string; elementIds: string[]; mode: AlignMode }>({
  name: 'align_elements',
  description: 'Line elements up with each other, or centre one on the page.',
  risk: 'safe',
  input: toolSchema(
    {
      documentId: str('The document id'),
      elementIds: strList('Element ids'),
      mode: {
        type: 'string',
        enum: ['left', 'center', 'right', 'top', 'middle', 'bottom', 'page-center'],
        description: 'How to align them',
      },
    },
    ['documentId', 'elementIds', 'mode'],
  ),
  async run({ documentId, elementIds, mode }, { session }) {
    const id = requireId(documentId, 'המסמך')
    if (isIdError(id)) return id
    const next = await edit(session, id, [{ type: 'align', elementIds, mode }])
    return next ? { summary: 'יושר.', target: { type: 'document', id } } : { summary: 'הפעולה נכשלה.' }
  },
})

export const addPage = defineTool<{ documentId: string; afterPage?: number }>({
  name: 'add_page',
  description: 'Add a blank A4 page to a designed document.',
  risk: 'safe',
  input: toolSchema(
    { documentId: str('The document id'), afterPage: { type: 'number', description: 'Insert after this page' } },
    ['documentId'],
  ),
  async run({ documentId, afterPage }, { session }) {
    const id = requireId(documentId, 'המסמך')
    if (isIdError(id)) return id
    const next = await edit(session, id, [
      { type: 'addPage', afterIndex: afterPage ? afterPage - 1 : undefined },
    ])
    return next
      ? { summary: `נוסף עמוד. סך הכול ${next.pages.length}.`, target: { type: 'document', id } }
      : { summary: 'הוספת העמוד נכשלה.' }
  },
})

export const setPageBackground = defineTool<{
  documentId: string
  page: number
  color?: string
  overlayOpacity?: number
}>({
  name: 'set_page_background',
  description: 'Set a page’s background colour, and the overlay strength over a background image.',
  risk: 'safe',
  input: toolSchema(
    {
      documentId: str('The document id'),
      page: { type: 'number', description: 'Page number, starting at 1' },
      color: str('A hex colour such as #0e7490'),
      overlayOpacity: { type: 'number', description: '0 to 1, darkening a background image' },
    },
    ['documentId', 'page'],
  ),
  async run({ documentId, page, color, overlayOpacity }, { session }) {
    const id = requireId(documentId, 'המסמך')
    if (isIdError(id)) return id
    const next = await edit(session, id, [
      {
        type: 'setBackground',
        pageIndex: Math.max(Math.round(page) - 1, 0),
        background: { color, overlayOpacity },
      },
    ])
    return next ? { summary: `רקע עמוד ${page} עודכן.`, target: { type: 'document', id } } : { summary: 'העדכון נכשל.' }
  },
})

export const createDesignedCanvas = defineTool<{
  companyId: string
  title: string
  pages: { background?: Record<string, unknown>; elements: Record<string, unknown>[] }[]
}>({
  name: 'create_designed_canvas_document',
  description:
    'Build a complete designed document from scratch on A4 pages and save it as a draft. Positions are millimetres from the top-right of a 210x297 page. Read get_brand_kit first so the letterhead uses the real company details. Nothing is sent.',
  risk: 'safe',
  input: toolSchema(
    {
      companyId: str('The company the document is for'),
      title: str('Document title'),
      pages: {
        type: 'array',
        description: 'One entry per A4 page, each with an elements array',
        items: { type: 'object' },
      },
    },
    ['companyId', 'title', 'pages'],
  ),
  async run(input, { session, ip, userAgent }) {
    const companyId = requireId(input.companyId, 'החברה')
    if (isIdError(companyId)) return companyId

    // Read so a design can carry the real letterhead rather than invented one.
    await getOrganizationProfile(session).catch(() => null)

    const document = parseCanvasDocument({
      version: 1,
      title: input.title,
      pages: (input.pages ?? []).map((page, index) => ({
        id: `p${index}`,
        background: page.background,
        elements: (page.elements ?? []).map((element, order) => ({
          ...element,
          id: newId(),
          zIndex: typeof element.zIndex === 'number' ? element.zIndex : order + 1,
        })),
      })),
    })
    if (!document || document.pages.every((page) => page.elements.length === 0)) {
      return { summary: 'לא הצלחתי לבנות את המסמך. נסו לתאר אותו שוב.' }
    }

    const { saveCanvasDocument } = await import('@/server/documents/canvas-save')
    const result = await saveCanvasDocument({
      session,
      title: input.title,
      document,
      companyId,
      ip,
      userAgent,
    })
    if (!result.ok) return { summary: result.message }

    return {
      summary: `נוצר מסמך מעוצב ב-${document.pages.length} עמודים.`,
      target: { type: 'document', id: result.agreementId },
      data: { kind: 'link', href: `/documents/${result.agreementId}/design`, label: 'פתח בעורך' },
    }
  },
})

/** Kept so the module's side effect of registering tools is never dropped. */
export const CANVAS_TOOLS = [
  getDocumentLayout,
  addElement,
  updateElement,
  removeElement,
  alignElements,
  addPage,
  setPageBackground,
  createDesignedCanvas,
]

void emptyDocument
