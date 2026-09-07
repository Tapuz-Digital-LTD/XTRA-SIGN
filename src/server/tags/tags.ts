import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { requireAdmin, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { isUuid } from '@/server/documents/authorization'
import { log } from '@/server/log'

/**
 * Tags: a light label an office puts on its suppliers and customers — "ספק
 * מועדף", "חייב חוזה 2026". XTRA-level only: a tag on a CRM-mirrored company
 * lives here and is never written back to Fireberry.
 *
 * Every query is scoped to the caller's organization; ids from another tenant
 * are silently dropped rather than refused, so a stale selection cannot be
 * used to probe which ids exist elsewhere.
 */

export type TagKind = 'company' | 'campaign'

export type Tag = {
  id: string
  kind: TagKind
  name: string
  color: string | null
}

export type BulkAction = 'add_tags' | 'remove_tags' | 'notes'

export type BulkResult = { eligible: number; updated: number; skipped: number }

const NAME_MAX = 60
const NOTE_MAX = 500

/** Trimmed, single-spaced, lower-cased: the key two spellings of one tag share. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The display name: the user's spelling, trimmed and single-spaced. */
function displayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
}

export function parseTagKind(value: unknown): TagKind | null {
  return value === 'company' || value === 'campaign' ? value : null
}

const tagColumns = {
  id: schema.tags.id,
  kind: sql<TagKind>`${schema.tags.kind}`,
  name: schema.tags.name,
  color: schema.tags.color,
}

export async function listTags(session: StaffSession, kind: TagKind): Promise<Tag[]> {
  return getDb()
    .select(tagColumns)
    .from(schema.tags)
    .where(and(eq(schema.tags.organizationId, session.organizationId), eq(schema.tags.kind, kind)))
    .orderBy(asc(schema.tags.name))
}

/**
 * Creates a tag, or returns the one that already has this name (by key) for
 * the organization and kind — so typing "ספק  מועדף" twice yields one tag.
 */
export async function createTag(
  session: StaffSession,
  input: { name: string; kind: TagKind; color?: string | null },
): Promise<{ ok: true; tag: Tag } | { ok: false; message: string }> {
  const name = displayName(input.name)
  const nameKey = normalizeTagName(input.name)
  if (!nameKey) return { ok: false, message: 'יש להזין שם לתג.' }

  const db = getDb()
  const [inserted] = await db
    .insert(schema.tags)
    .values({
      organizationId: session.organizationId,
      kind: input.kind,
      name,
      nameKey,
      color: input.color?.trim().slice(0, 20) || null,
      createdBy: session.userId,
    })
    .onConflictDoNothing()
    .returning(tagColumns)
  if (inserted) return { ok: true, tag: inserted }

  const [existing] = await db
    .select(tagColumns)
    .from(schema.tags)
    .where(and(eq(schema.tags.organizationId, session.organizationId), eq(schema.tags.kind, input.kind), eq(schema.tags.nameKey, nameKey)))
    .limit(1)
  return existing ? { ok: true, tag: existing } : { ok: false, message: 'יצירת התג נכשלה.' }
}

export async function renameTag(
  session: StaffSession,
  id: string,
  name: string,
): Promise<{ ok: true; tag: Tag } | { ok: false; message: string }> {
  const display = displayName(name)
  const nameKey = normalizeTagName(name)
  if (!nameKey) return { ok: false, message: 'יש להזין שם לתג.' }
  if (!isUuid(id)) return { ok: false, message: 'התג לא נמצא.' }

  const db = getDb()
  const [current] = await db
    .select(tagColumns)
    .from(schema.tags)
    .where(and(eq(schema.tags.id, id), eq(schema.tags.organizationId, session.organizationId)))
    .limit(1)
  if (!current) return { ok: false, message: 'התג לא נמצא.' }

  const [clash] = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.organizationId, session.organizationId), eq(schema.tags.kind, current.kind), eq(schema.tags.nameKey, nameKey)))
    .limit(1)
  if (clash && clash.id !== id) return { ok: false, message: 'כבר קיים תג בשם הזה.' }

  const [tag] = await db
    .update(schema.tags)
    .set({ name: display, nameKey })
    .where(and(eq(schema.tags.id, id), eq(schema.tags.organizationId, session.organizationId)))
    .returning(tagColumns)
  return { ok: true, tag }
}

/** Admin only. The tag and every link to it go; the companies stay as they are. */
export async function deleteTag(session: StaffSession, id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  requireAdmin(session)
  if (!isUuid(id)) return { ok: false, message: 'התג לא נמצא.' }
  const removed = await getDb()
    .delete(schema.tags)
    .where(and(eq(schema.tags.id, id), eq(schema.tags.organizationId, session.organizationId)))
    .returning({ id: schema.tags.id })
  return removed.length > 0 ? { ok: true } : { ok: false, message: 'התג לא נמצא.' }
}

/** The caller's own, live companies among the ids given — whatever ids arrived. */
async function ownCompanyIds(organizationId: string, companyIds: string[]): Promise<string[]> {
  const ids = [...new Set(companyIds.filter(isUuid))]
  if (ids.length === 0) return []
  const rows = await getDb()
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(inArray(schema.companies.id, ids), eq(schema.companies.organizationId, organizationId), isNull(schema.companies.deletedAt)))
  return rows.map((r) => r.id)
}

async function ownTagIds(organizationId: string, tagIds: string[]): Promise<string[]> {
  const ids = [...new Set(tagIds.filter(isUuid))]
  if (ids.length === 0) return []
  const rows = await getDb()
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(inArray(schema.tags.id, ids), eq(schema.tags.organizationId, organizationId), eq(schema.tags.kind, 'company')))
  return rows.map((r) => r.id)
}

/**
 * Adds tags to companies. Explicit add: a company's other tags are untouched.
 * `updated` counts companies that gained at least one tag; `skipped` the ones
 * that already had every tag listed.
 */
export async function addCompanyTags(
  session: StaffSession,
  companyIds: string[],
  tagIds: string[],
): Promise<{ updated: number; skipped: number }> {
  const [companies, tags] = await Promise.all([ownCompanyIds(session.organizationId, companyIds), ownTagIds(session.organizationId, tagIds)])
  if (companies.length === 0 || tags.length === 0) return { updated: 0, skipped: companies.length }

  const inserted = await getDb()
    .insert(schema.companyTags)
    .values(companies.flatMap((companyId) => tags.map((tagId) => ({ companyId, tagId, createdBy: session.userId }))))
    .onConflictDoNothing()
    .returning({ companyId: schema.companyTags.companyId })

  const touched = new Set(inserted.map((r) => r.companyId)).size
  return { updated: touched, skipped: companies.length - touched }
}

/** Removes only the tags listed; anything else on the company stays. */
export async function removeCompanyTags(
  session: StaffSession,
  companyIds: string[],
  tagIds: string[],
): Promise<{ updated: number; skipped: number }> {
  const [companies, tags] = await Promise.all([ownCompanyIds(session.organizationId, companyIds), ownTagIds(session.organizationId, tagIds)])
  if (companies.length === 0 || tags.length === 0) return { updated: 0, skipped: companies.length }

  const removed = await getDb()
    .delete(schema.companyTags)
    .where(and(inArray(schema.companyTags.companyId, companies), inArray(schema.companyTags.tagId, tags)))
    .returning({ companyId: schema.companyTags.companyId })

  const touched = new Set(removed.map((r) => r.companyId)).size
  return { updated: touched, skipped: companies.length - touched }
}

/** The tags of many companies in one query, for a list screen. */
export async function tagsForCompanies(organizationId: string, companyIds: string[]): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>()
  const ids = companyIds.filter(isUuid)
  if (ids.length === 0) return out

  const rows = await getDb()
    .select({ companyId: schema.companyTags.companyId, ...tagColumns })
    .from(schema.companyTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.companyTags.tagId))
    .where(and(inArray(schema.companyTags.companyId, ids), eq(schema.tags.organizationId, organizationId)))
    .orderBy(asc(schema.tags.name))

  for (const { companyId, ...tag } of rows) {
    const list = out.get(companyId)
    if (list) list.push(tag)
    else out.set(companyId, [tag])
  }
  return out
}

/**
 * One bulk edit over a selection. `preview` answers "how many records would
 * this touch?" without writing anything. A note is appended as a new line —
 * what was written before is never replaced.
 */
export async function bulkEditCompanies(
  session: StaffSession,
  input: { companyIds: string[]; action: BulkAction; tagIds?: string[]; notes?: string; preview: boolean },
): Promise<{ ok: true } & BulkResult | { ok: false; message: string }> {
  const companies = await ownCompanyIds(session.organizationId, input.companyIds)
  const eligible = companies.length
  if (input.preview) return { ok: true, eligible, updated: 0, skipped: 0 }

  let result: { updated: number; skipped: number }
  if (input.action === 'notes') {
    const line = (input.notes ?? '').trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX)
    if (!line) return { ok: false, message: 'יש לכתוב הערה.' }
    if (eligible === 0) result = { updated: 0, skipped: 0 }
    else {
      const rows = await getDb()
        .update(schema.companies)
        .set({ notes: sql`case when ${schema.companies.notes} is null or ${schema.companies.notes} = '' then ${line} else ${schema.companies.notes} || E'\n' || ${line} end` })
        .where(inArray(schema.companies.id, companies))
        .returning({ id: schema.companies.id })
      result = { updated: rows.length, skipped: eligible - rows.length }
    }
  } else {
    const tagIds = input.tagIds ?? []
    if (tagIds.length === 0) return { ok: false, message: 'יש לבחור לפחות תג אחד.' }
    result =
      input.action === 'add_tags'
        ? await addCompanyTags(session, companies, tagIds)
        : await removeCompanyTags(session, companies, tagIds)
  }

  // ponytail: no company-level audit table exists; the structured log is the record.
  log.info('companies_bulk_edit', {
    organizationId: session.organizationId,
    userId: session.userId,
    action: input.action,
    eligible,
    ...result,
    tagIds: input.tagIds ?? [],
  })
  return { ok: true, eligible, ...result }
}
