import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'

/**
 * Suppliers and customers — the parties an organization signs with.
 *
 * A company is the folder an agreement is filed under, so the app is a set of
 * companies each holding their documents rather than one endless list. Every
 * query here is scoped to the caller's organization; a company, like a
 * document, never crosses a tenant boundary.
 */

export type CompanyKind = 'supplier' | 'customer'

export type CompanyInput = {
  name: string
  taxId?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  notes?: string | null
  crmRecordId?: string | null
}

export type CompanyRow = {
  id: string
  kind: CompanyKind
  name: string
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  notes: string | null
  crmRecordId: string | null
  crmObjectType: number | null
  createdAt: Date
}

export type CompanyListItem = CompanyRow & {
  documentCount: number
  signedCount: number
  pendingCount: number
  lastActivityAt: Date | null
}

export type CompanyResult = { ok: true; id: string } | { ok: false; message: string }

const clean = (value: string | null | undefined, max = 200): string | null => {
  const trimmed = (value ?? '').trim().slice(0, max)
  return trimmed === '' ? null : trimmed
}

/** Validates the shared fields for create and update. */
function validate(input: CompanyInput): { name: string } | { error: string } {
  const name = (input.name ?? '').trim().slice(0, 200)
  if (!name) return { error: 'יש להזין שם.' }
  const email = clean(input.contactEmail)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'כתובת האימייל אינה תקינה.' }
  }
  return { name }
}

/** A phone is stored as typed when it is not a valid mobile — it is a contact
 *  detail here, not a login credential, so an office landline is allowed. */
function normaliseContactPhone(value: string | null): string | null {
  const trimmed = clean(value)
  if (!trimmed) return null
  return normalizeIsraeliPhone(trimmed) ?? trimmed
}

export async function createCompany(input: {
  session: StaffSession
  kind: CompanyKind
  data: CompanyInput
}): Promise<CompanyResult> {
  const checked = validate(input.data)
  if ('error' in checked) return { ok: false, message: checked.error }

  const [row] = await getDb()
    .insert(schema.companies)
    .values({
      organizationId: input.session.organizationId,
      kind: input.kind,
      name: checked.name,
      taxId: clean(input.data.taxId, 40),
      contactName: clean(input.data.contactName),
      contactPhone: normaliseContactPhone(input.data.contactPhone ?? null),
      contactEmail: clean(input.data.contactEmail),
      notes: clean(input.data.notes, 2000),
      crmRecordId: clean(input.data.crmRecordId, 100),
    })
    .returning({ id: schema.companies.id })

  return { ok: true, id: row.id }
}

export async function updateCompany(input: {
  session: StaffSession
  companyId: string
  data: CompanyInput
}): Promise<CompanyResult> {
  const checked = validate(input.data)
  if ('error' in checked) return { ok: false, message: checked.error }

  const db = getDb()
  // Scope in the WHERE clause: another tenant's company cannot be edited by id.
  const result = await db
    .update(schema.companies)
    .set({
      name: checked.name,
      taxId: clean(input.data.taxId, 40),
      contactName: clean(input.data.contactName),
      contactPhone: normaliseContactPhone(input.data.contactPhone ?? null),
      contactEmail: clean(input.data.contactEmail),
      notes: clean(input.data.notes, 2000),
      crmRecordId: clean(input.data.crmRecordId, 100),
    })
    .where(
      and(
        eq(schema.companies.id, input.companyId),
        eq(schema.companies.organizationId, input.session.organizationId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .returning({ id: schema.companies.id })

  if (result.length === 0) return { ok: false, message: 'החברה לא נמצאה.' }
  return { ok: true, id: result[0].id }
}

/**
 * Soft delete. The agreements filed under a company keep pointing at it, so the
 * row must survive; it is simply hidden from the lists.
 */
export async function deleteCompany(input: {
  session: StaffSession
  companyId: string
}): Promise<CompanyResult> {
  const result = await getDb()
    .update(schema.companies)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.companies.id, input.companyId),
        eq(schema.companies.organizationId, input.session.organizationId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .returning({ id: schema.companies.id })

  if (result.length === 0) return { ok: false, message: 'החברה לא נמצאה.' }
  return { ok: true, id: result[0].id }
}

/**
 * Every company of one kind, each with the counts its card shows.
 *
 * Companies are fetched first, then document stats in one grouped pass and
 * merged in — so a company with no documents still appears, with zeroes.
 */
export async function listCompanies(
  session: StaffSession,
  kind: CompanyKind,
  search?: string,
): Promise<CompanyListItem[]> {
  const db = getDb()
  const a = schema.agreements

  const conditions = [
    eq(schema.companies.organizationId, session.organizationId),
    eq(schema.companies.kind, kind),
    isNull(schema.companies.deletedAt),
  ]
  const term = search?.trim()
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(ilike(schema.companies.name, like))
  }

  const companies = await db
    .select({
      id: schema.companies.id,
      kind: schema.companies.kind,
      name: schema.companies.name,
      taxId: schema.companies.taxId,
      contactName: schema.companies.contactName,
      contactPhone: schema.companies.contactPhone,
      contactEmail: schema.companies.contactEmail,
      notes: schema.companies.notes,
      crmRecordId: schema.companies.crmRecordId,
      crmObjectType: schema.companies.crmObjectType,
      createdAt: schema.companies.createdAt,
    })
    .from(schema.companies)
    .where(and(...conditions))
    .orderBy(desc(schema.companies.createdAt))
    .limit(500)

  if (companies.length === 0) return []

  // Counts in one grouped pass rather than a correlated subquery per company:
  // scoped to this organization, this kind, and — for a non-admin — the
  // caller's own documents, the same visibility rule the document lists use.
  const ids = companies.map((c) => c.id)
  const countConditions = [
    eq(schema.companies.organizationId, session.organizationId),
    eq(schema.companies.kind, kind),
    inArray(a.companyId, ids),
  ]
  if (!session.isAdmin) countConditions.push(eq(a.ownerId, session.userId))

  const stats = await db
    .select({
      companyId: a.companyId,
      documentCount: sql<number>`count(*)`,
      signedCount: sql<number>`count(*) filter (where ${a.status} = 'signed')`,
      pendingCount: sql<number>`count(*) filter (where ${a.status} in ('sent','viewed'))`,
      lastActivityAt: sql<Date | null>`max(${a.createdAt})`,
    })
    .from(a)
    .innerJoin(schema.companies, eq(schema.companies.id, a.companyId))
    .where(and(...countConditions))
    .groupBy(a.companyId)

  const byId = new Map(stats.map((s) => [s.companyId, s]))

  return companies.map((c) => {
    const s = byId.get(c.id)
    return {
      ...c,
      documentCount: Number(s?.documentCount ?? 0),
      signedCount: Number(s?.signedCount ?? 0),
      pendingCount: Number(s?.pendingCount ?? 0),
      lastActivityAt: s?.lastActivityAt ? new Date(s.lastActivityAt) : null,
    }
  })
}

/** One company, scoped to the tenant. null when it is missing or another org's. */
export async function getCompany(
  session: StaffSession,
  companyId: string,
): Promise<CompanyRow | null> {
  const [row] = await getDb()
    .select({
      id: schema.companies.id,
      kind: schema.companies.kind,
      name: schema.companies.name,
      taxId: schema.companies.taxId,
      contactName: schema.companies.contactName,
      contactPhone: schema.companies.contactPhone,
      contactEmail: schema.companies.contactEmail,
      notes: schema.companies.notes,
      crmRecordId: schema.companies.crmRecordId,
      crmObjectType: schema.companies.crmObjectType,
      createdAt: schema.companies.createdAt,
    })
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.id, companyId),
        eq(schema.companies.organizationId, session.organizationId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .limit(1)

  return row ?? null
}

/**
 * Confirms a company id belongs to the caller's organization, for the moment an
 * agreement is filed under one. Returns the id when valid, null otherwise, so a
 * caller can drop a bad reference rather than trust it.
 */
export async function resolveOwnCompanyId(
  session: StaffSession,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null
  const company = await getCompany(session, companyId)
  return company ? company.id : null
}
