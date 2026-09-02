import { and, eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { ForbiddenError } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { isAutoSource } from '@/server/documents/personalization'
import { clampToPage, toVariableKey, type FieldType, type PlacedField } from '@/lib/fields'
import { authorizeAgreementAccess } from './authorization'

/**
 * Saves the whole field layout for a version.
 *
 * Replace-all rather than a diff: the editor holds the complete layout, an
 * autosave carries it in full, and a per-field patch protocol would have to
 * handle reordering, deletes racing moves, and partial application. Replacing
 * one small set of rows inside a transaction is simpler and cannot half-apply.
 */

const VALID_TYPES = new Set<FieldType>([
  'signature', 'full_name', 'text', 'number', 'date',
  'checkbox', 'select', 'email', 'phone', 'file',
])

/** A layout with more fields than this is a bug or an attack, not a document. */
const MAX_FIELDS = 200

export type SaveFieldsResult = { ok: true; count: number } | { ok: false; message: string }

export async function saveFields(input: {
  session: StaffSession
  agreementId: string
  fields: unknown
}): Promise<SaveFieldsResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)

  // A sent or signed document's layout is frozen. Editing it afterwards would
  // change what the signer agreed to, which is the whole point of versioning.
  if (agreement.status !== 'draft') {
    return { ok: false, message: 'לא ניתן לערוך מסמך שכבר נשלח.' }
  }

  if (!Array.isArray(input.fields)) return { ok: false, message: 'נתונים לא תקינים.' }
  if (input.fields.length > MAX_FIELDS) return { ok: false, message: 'יותר מדי שדות במסמך.' }

  const db = getDb()

  const [version] = await db
    .select({ id: schema.agreementVersions.id, pageCount: schema.agreementVersions.pageCount })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, agreement.currentVersionId ?? ''))
    .limit(1)

  if (!version) throw new ForbiddenError()

  const pageCount = version.pageCount ?? 1
  const usedKeys: string[] = []
  const rows: (typeof schema.fields.$inferInsert)[] = []

  for (const raw of input.fields) {
    const parsed = parseField(raw, pageCount)
    if (!parsed) return { ok: false, message: 'נתונים לא תקינים.' }

    const variableKey = toVariableKey(parsed.label, usedKeys)
    usedKeys.push(variableKey)

    rows.push({
      agreementVersionId: version.id,
      type: parsed.type,
      label: parsed.label,
      variableKey,
      ownedBy: parsed.ownedBy,
      required: parsed.required,
      page: parsed.page,
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      options: parsed.options,
      placeholder: parsed.placeholder,
      autoFill: parsed.autoFill,
      autoSource: parsed.autoSource,
      // Only a field we fill in carries a value at this stage.
      value: parsed.ownedBy === 'sender' ? parsed.value : null,
    })
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.fields).where(eq(schema.fields.agreementVersionId, version.id))
    if (rows.length > 0) await tx.insert(schema.fields).values(rows)
  })

  return { ok: true, count: rows.length }
}

/**
 * Validates one field from the client.
 *
 * Everything here arrives from a browser, so every number is bounded and every
 * string is capped. A NaN in a coordinate would place a field nowhere and a
 * 10MB label would be stored verbatim.
 */
function parseField(raw: unknown, pageCount: number): PlacedField | null {
  if (typeof raw !== 'object' || raw === null) return null
  const f = raw as Record<string, unknown>

  const type = f.type as FieldType
  if (!VALID_TYPES.has(type)) return null

  const ownedBy = f.ownedBy === 'sender' ? 'sender' : f.ownedBy === 'signer' ? 'signer' : null
  if (!ownedBy) return null

  const label = typeof f.label === 'string' ? f.label.trim().slice(0, 100) : ''
  if (!label) return null

  const page = Number(f.page)
  if (!Number.isInteger(page) || page < 1 || page > pageCount) return null

  // Strictly numbers, not "whatever Number() makes of it". Number(null) is 0,
  // so a missing coordinate would silently become a field pinned to the page
  // edge rather than a rejected payload.
  const nums = ['x', 'y', 'width', 'height'].map((k) => f[k])
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [x, y, width, height] = nums as number[]

  const options = Array.isArray(f.options)
    ? f.options
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 30)
    : null

  // A select with no choices cannot be filled in.
  if (type === 'select' && (!options || options.length === 0)) return null

  return {
    id: typeof f.id === 'string' ? f.id : crypto.randomUUID(),
    type,
    label,
    ownedBy,
    required: f.required !== false,
    page,
    ...clampToPage({ x, y, width, height }),
    value: typeof f.value === 'string' ? f.value.slice(0, 500) : null,
    options,
    placeholder: typeof f.placeholder === 'string' ? f.placeholder.slice(0, 200) : null,
    autoFill: f.autoFill === true,
    // Validated against the known sources: an arbitrary string here would be a
    // silent no-op at send time rather than a rejected layout.
    autoSource: isAutoSource(f.autoSource) ? f.autoSource : null,
  }
}

export async function loadFields(versionId: string): Promise<PlacedField[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.fields)
    .where(eq(schema.fields.agreementVersionId, versionId))

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    ownedBy: row.ownedBy,
    required: row.required,
    page: row.page,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    value: row.value,
    options: (row.options as string[] | null) ?? null,
    placeholder: row.placeholder,
    autoFill: row.autoFill,
    autoSource: row.autoSource ?? null,
  }))
}

export async function loadPageGeometry(versionId: string) {
  const db = getDb()
  return db
    .select({
      pageNumber: schema.documentPages.pageNumber,
      widthPt: schema.documentPages.widthPt,
      heightPt: schema.documentPages.heightPt,
    })
    .from(schema.documentPages)
    .where(eq(schema.documentPages.agreementVersionId, versionId))
    .orderBy(schema.documentPages.pageNumber)
}

/** Saves the signer's details on a draft. */
export async function saveRecipient(input: {
  session: StaffSession
  agreementId: string
  name: string
  company?: string | null
  phone?: string | null
  email?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status !== 'draft') {
    return { ok: false, message: 'לא ניתן לערוך מסמך שכבר נשלח.' }
  }

  const name = input.name.trim().slice(0, 120)
  if (!name) return { ok: false, message: 'יש להזין שם.' }

  const { normalizeIsraeliPhone } = await import('@/lib/phone')
  const phone = input.phone?.trim() ? normalizeIsraeliPhone(input.phone) : null
  if (input.phone?.trim() && !phone) {
    return { ok: false, message: 'מספר הטלפון אינו תקין.' }
  }

  const email = input.email?.trim().slice(0, 200) || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'כתובת האימייל אינה תקינה.' }
  }

  const db = getDb()
  const existing = await db
    .select({ id: schema.recipients.id })
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  const values = {
    name,
    company: input.company?.trim().slice(0, 200) || null,
    phone,
    email,
  }

  if (existing[0]) {
    await db
      .update(schema.recipients)
      .set(values)
      .where(
        and(
          eq(schema.recipients.id, existing[0].id),
          eq(schema.recipients.agreementId, agreement.id),
        ),
      )
  } else {
    await db.insert(schema.recipients).values({ agreementId: agreement.id, ...values })
  }

  return { ok: true }
}
