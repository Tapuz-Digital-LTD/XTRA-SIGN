import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import type { CompanyKind } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { isUuid } from '@/server/documents/authorization'

/**
 * Groups: a hand-picked list of companies to work with together.
 *
 * Membership is explicit rather than derived. "ספקי פסח" is somebody's decision
 * about who belongs, and a saved search would silently change the list between
 * one send and the next.
 *
 * Deleting a group removes the grouping and nothing else — the companies and
 * every agreement ever sent to them are untouched, which is why it is a soft
 * delete that past batches can still point at.
 */

const MAX_NAME = 120

export type GroupListItem = {
  id: string
  name: string
  description: string | null
  /** null for the groups that predate the split; they belong to both. */
  kind: 'supplier' | 'customer' | null
  companyCount: number
  createdAt: Date
}

export type GroupResult = { ok: true; id: string } | { ok: false; message: string }

function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim()
  return name ? name.slice(0, MAX_NAME) : null
}

/** The single door to a group: tenant filter in the WHERE, not after it. */
export async function authorizeGroup(session: StaffSession, groupId: string) {
  if (!isUuid(groupId)) throw new ForbiddenError()
  const [group] = await getDb()
    .select()
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.id, groupId),
        eq(schema.groups.organizationId, session.organizationId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .limit(1)
  if (!group) throw new ForbiddenError()
  return group
}

export async function listGroups(
  session: StaffSession,
  /**
   * Restricts to the groups a supplier or a customer screen should offer.
   * Groups created before kinds existed have none and belong to both, so
   * filtering must keep them rather than hide work already organised.
   */
  kind?: 'supplier' | 'customer',
): Promise<GroupListItem[]> {
  // A join and a group-by rather than a correlated subquery: the aliasing a
  // subquery needs does not survive being interpolated, and this is the shape
  // the database is happiest with anyway.
  const rows = await getDb()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      description: schema.groups.description,
      createdAt: schema.groups.createdAt,
      kind: schema.groups.kind,
      companyCount: sql<number>`count(${schema.companies.id})`,
    })
    .from(schema.groups)
    .leftJoin(schema.companyGroups, eq(schema.companyGroups.groupId, schema.groups.id))
    .leftJoin(
      schema.companies,
      and(eq(schema.companies.id, schema.companyGroups.companyId), isNull(schema.companies.deletedAt)),
    )
    .where(
      and(
        eq(schema.groups.organizationId, session.organizationId),
        isNull(schema.groups.deletedAt),
        kind ? or(eq(schema.groups.kind, kind), isNull(schema.groups.kind)) : undefined,
      ),
    )
    .groupBy(
      schema.groups.id,
      schema.groups.name,
      schema.groups.description,
      schema.groups.createdAt,
      schema.groups.kind,
    )
    .orderBy(desc(schema.groups.createdAt))

  return rows.map((row) => ({
    ...row,
    kind: (row.kind as 'supplier' | 'customer' | null) ?? null,
    companyCount: Number(row.companyCount),
  }))
}

export async function createGroup(input: {
  session: StaffSession
  name: string
  description?: string | null
  kind?: 'supplier' | 'customer' | null
  /** Seed membership, for "create a group from this selection". */
  companyIds?: string[]
}): Promise<GroupResult> {
  const name = cleanName(input.name)
  if (!name) return { ok: false, message: 'יש להזין שם לקבוצה.' }

  const [group] = await getDb()
    .insert(schema.groups)
    .values({
      organizationId: input.session.organizationId,
      name,
      description: input.description?.trim().slice(0, 2000) || null,
      kind: input.kind === 'supplier' || input.kind === 'customer' ? input.kind : null,
      createdBy: input.session.userId,
    })
    .returning({ id: schema.groups.id })

  if (input.companyIds?.length) {
    await addCompanies({ session: input.session, groupId: group.id, companyIds: input.companyIds })
  }
  return { ok: true, id: group.id }
}

export async function renameGroup(input: {
  session: StaffSession
  groupId: string
  name: string
  description?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const group = await authorizeGroup(input.session, input.groupId)
  const name = cleanName(input.name)
  if (!name) return { ok: false, message: 'יש להזין שם לקבוצה.' }

  await getDb()
    .update(schema.groups)
    .set({ name, description: input.description?.trim().slice(0, 2000) || null })
    .where(eq(schema.groups.id, group.id))
  return { ok: true }
}

/** Soft delete. Companies, agreements and past batches are untouched. */
export async function deleteGroup(session: StaffSession, groupId: string): Promise<{ ok: true }> {
  const group = await authorizeGroup(session, groupId)
  await getDb().update(schema.groups).set({ deletedAt: new Date() }).where(eq(schema.groups.id, group.id))
  return { ok: true }
}

/**
 * Adds companies, ignoring ones already in. Only companies from the caller's
 * own organization are accepted, whatever ids arrived.
 */
export async function addCompanies(input: {
  session: StaffSession
  groupId: string
  companyIds: string[]
}): Promise<{ ok: true; added: number }> {
  const group = await authorizeGroup(input.session, input.groupId)
  const ids = input.companyIds.filter(isUuid)
  if (ids.length === 0) return { ok: true, added: 0 }

  const db = getDb()
  const owned = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(
      and(
        inArray(schema.companies.id, ids),
        eq(schema.companies.organizationId, input.session.organizationId),
        isNull(schema.companies.deletedAt),
      ),
    )
  if (owned.length === 0) return { ok: true, added: 0 }

  const result = await db
    .insert(schema.companyGroups)
    .values(owned.map((c) => ({ groupId: group.id, companyId: c.id })))
    .onConflictDoNothing()
    .returning({ companyId: schema.companyGroups.companyId })

  return { ok: true, added: result.length }
}

export async function removeCompanies(input: {
  session: StaffSession
  groupId: string
  companyIds: string[]
}): Promise<{ ok: true; removed: number }> {
  const group = await authorizeGroup(input.session, input.groupId)
  const ids = input.companyIds.filter(isUuid)
  if (ids.length === 0) return { ok: true, removed: 0 }

  const removed = await getDb()
    .delete(schema.companyGroups)
    .where(and(eq(schema.companyGroups.groupId, group.id), inArray(schema.companyGroups.companyId, ids)))
    .returning({ companyId: schema.companyGroups.companyId })

  return { ok: true, removed: removed.length }
}

export type GroupCompany = {
  id: string
  name: string
  kind: CompanyKind
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  fromCrm: boolean
  /** Whether a bulk send could reach this company without someone filling something in. */
  readyToSend: boolean
}

export async function listGroupCompanies(
  session: StaffSession,
  groupId: string,
  search?: string,
): Promise<GroupCompany[]> {
  const group = await authorizeGroup(session, groupId)
  const conditions = [
    eq(schema.companyGroups.groupId, group.id),
    isNull(schema.companies.deletedAt),
    eq(schema.companies.organizationId, session.organizationId),
  ]

  const term = search?.trim()
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(
      sql`(${schema.companies.name} ilike ${like} or ${schema.companies.taxId} ilike ${like} or ${schema.companies.contactName} ilike ${like})`,
    )
  }

  const rows = await getDb()
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      kind: schema.companies.kind,
      taxId: schema.companies.taxId,
      contactName: schema.companies.contactName,
      contactPhone: schema.companies.contactPhone,
      contactEmail: schema.companies.contactEmail,
      crmRecordId: schema.companies.crmRecordId,
    })
    .from(schema.companyGroups)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyGroups.companyId))
    .where(and(...conditions))
    .orderBy(schema.companies.name)
    .limit(1000)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    taxId: row.taxId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    fromCrm: Boolean(row.crmRecordId),
    // A signer needs a name, and somewhere to send the link.
    readyToSend: Boolean(row.contactName?.trim() && (row.contactPhone || row.contactEmail)),
  }))
}

/** Which groups a company belongs to, for chips on its page. */
export async function groupsForCompany(
  session: StaffSession,
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.companyGroups)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.companyGroups.groupId))
    .where(
      and(
        eq(schema.companyGroups.companyId, companyId),
        eq(schema.groups.organizationId, session.organizationId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .orderBy(schema.groups.name)
}
