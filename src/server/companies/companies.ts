import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { validateCompanyFields, type CompanyFieldErrors } from '@/lib/company-validation'
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
  crmSyncedAt: Date | null
  address: string | null
  createdAt: Date
}

export type CompanyListItem = CompanyRow & {
  documentCount: number
  signedCount: number
  pendingCount: number
  lastActivityAt: Date | null
}

export type { CompanyFieldErrors }

export type CompanyResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fields?: CompanyFieldErrors }

const clean = (value: string | null | undefined, max = 200): string | null => {
  const trimmed = (value ?? '').trim().slice(0, max)
  return trimmed === '' ? null : trimmed
}

/** Validates the shared fields for create and update. */
/**
 * Field-level validation, returned per field so the form can point at what is
 * wrong rather than showing one message under everything.
 *
 * The phone matters more than it looks: it is what an OTP and a signing link
 * are sent to. Accepting "abc" here does not fail here — it fails weeks later,
 * when a document will not reach its signer and nobody knows why.
 */
function validate(input: CompanyInput): { name: string } | { error: string; fields: CompanyFieldErrors } {
  const fields = validateCompanyFields({
    name: input.name,
    taxId: input.taxId,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
  })

  const first = Object.values(fields)[0]
  if (first) return { error: first, fields }
  return { name: (input.name ?? '').trim().slice(0, 200) }
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
  if ('error' in checked) return { ok: false, message: checked.error, fields: checked.fields }

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
  if ('error' in checked) return { ok: false, message: checked.error, fields: checked.fields }

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
/**
 * Companies of either kind, for a picker.
 *
 * `listCompanies` is the screen query: it is per-kind and carries document
 * counts. Filing a document needs neither — it needs a short, fast list that
 * spans suppliers and customers together, so this is a separate, smaller query
 * rather than two calls and a merge in the caller.
 */
/** Full contact details for a set of companies, for an export. */
export async function withContactDetails(
  session: StaffSession,
  ids: string[],
): Promise<
  {
    id: string
    name: string
    kind: CompanyKind
    taxId: string | null
    contactName: string | null
    contactPhone: string | null
    contactEmail: string | null
    fromCrm: boolean
  }[]
> {
  if (ids.length === 0) return []
  const rows = await getDb()
    .select()
    .from(schema.companies)
    .where(
      and(
        inArray(schema.companies.id, ids),
        eq(schema.companies.organizationId, session.organizationId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .orderBy(schema.companies.name)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    taxId: row.taxId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    fromCrm: Boolean(row.crmRecordId),
  }))
}

export async function searchCompanies(
  session: StaffSession,
  search: string,
  limit = 20,
  kind?: CompanyKind,
): Promise<{ id: string; name: string; kind: CompanyKind; taxId: string | null; fromCrm: boolean }[]> {
  const term = search.trim()
  const conditions = [
    eq(schema.companies.organizationId, session.organizationId),
    isNull(schema.companies.deletedAt),
  ]
  if (kind) conditions.push(eq(schema.companies.kind, kind))
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(
      or(
        ilike(schema.companies.name, like),
        ilike(schema.companies.taxId, like),
        ilike(schema.companies.contactName, like),
      )!,
    )
  }

  const rows = await getDb()
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      kind: schema.companies.kind,
      taxId: schema.companies.taxId,
      crmRecordId: schema.companies.crmRecordId,
    })
    .from(schema.companies)
    .where(and(...conditions))
    // Newest first. For CRM rows this is when the record reached us, which
    // tracks CRM activity order; a brand-new customer lands at the top.
    .orderBy(desc(schema.companies.createdAt), schema.companies.name)
    .limit(Math.min(Math.max(limit, 1), 50))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    taxId: row.taxId,
    fromCrm: Boolean(row.crmRecordId),
  }))
}

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
    // Name, ח.פ and contact — the three things someone remembers a company by.
    conditions.push(
      or(
        ilike(schema.companies.name, like),
        ilike(schema.companies.taxId, like),
        ilike(schema.companies.contactName, like),
      )!,
    )
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
      crmSyncedAt: schema.companies.crmSyncedAt,
      address: schema.companies.address,
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
/**
 * Which CRM object a company's record lives in.
 *
 * Older links stored the record id without the object type, which left the page
 * showing a CRM badge while every CRM action refused it as "not connected".
 * The kind answers it: a supplier is object 1000, a customer is object 1.
 */
export function crmObjectTypeFor(company: {
  kind: CompanyKind
  crmObjectType: number | null
}): number {
  return company.crmObjectType ?? (company.kind === 'customer' ? 1 : 1000)
}

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
      crmSyncedAt: schema.companies.crmSyncedAt,
      address: schema.companies.address,
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
