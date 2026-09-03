import { and, desc, eq, sql } from 'drizzle-orm'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { createCompany } from '@/server/companies/companies'
import { findLocalDuplicate } from '@/server/companies/duplicates'
import { getDb, schema } from '@/server/db'
import { addCompanies, authorizeGroup } from '@/server/groups/groups'

/**
 * Leads: submissions from a project's joining form, waiting for a person.
 *
 * A lead never becomes a supplier by itself. Approval creates (or links) the
 * company, adds it to the project, and remembers which company came of the
 * lead — so nothing typed into the form is ever retyped.
 */

export type LeadData = {
  name?: string
  taxId?: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  [key: string]: string | undefined
}

export type LeadItem = {
  id: string
  status: 'new' | 'approved' | 'rejected'
  data: LeadData
  companyId: string | null
  createdAt: Date
  reviewedAt: Date | null
  source: string
  /** A company we already hold that looks like the same business. */
  duplicate: { id: string; name: string } | null
}

export async function listLeads(session: StaffSession, groupId: string): Promise<LeadItem[]> {
  await authorizeGroup(session, groupId)
  const rows = await getDb()
    .select()
    .from(schema.projectLeads)
    .where(eq(schema.projectLeads.groupId, groupId))
    .orderBy(desc(schema.projectLeads.createdAt))
    .limit(200)

  return Promise.all(
    rows.map(async (row) => {
      const data = (row.data ?? {}) as LeadData
      // Only unreviewed leads are worth a duplicate lookup: it is what the
      // reviewer needs at the moment of the decision, and nowhere else.
      const duplicate =
        row.status === 'new' && data.name
          ? await findLocalDuplicate(session, {
              name: data.name,
              taxId: data.taxId ?? null,
              contactPhone: data.phone ?? null,
              contactEmail: data.email ?? null,
            })
          : null
      return {
        id: row.id,
        status: row.status as LeadItem['status'],
        data,
        companyId: row.companyId,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        source: row.source,
        duplicate,
      }
    }),
  )
}

async function loadLead(session: StaffSession, leadId: string) {
  const [lead] = await getDb()
    .select()
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.id, leadId), eq(schema.projectLeads.organizationId, session.organizationId)))
    .limit(1)
  if (!lead) throw new ForbiddenError()
  return lead
}

export type LeadActionResult = { ok: true; companyId?: string } | { ok: false; message: string }

/**
 * Approves a lead: the submitted details become a local supplier (or attach to
 * an existing company), the company joins the project, and the lead points at
 * what it became.
 */
export async function approveLead(
  session: StaffSession,
  leadId: string,
  options: { useExistingCompanyId?: string } = {},
): Promise<LeadActionResult> {
  const lead = await loadLead(session, leadId)
  if (lead.status !== 'new') return { ok: false, message: 'הליד כבר טופל.' }
  const data = (lead.data ?? {}) as LeadData

  let companyId = options.useExistingCompanyId ?? null
  if (companyId) {
    // Attaching to an existing company must not cross tenants.
    const [company] = await getDb()
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(and(eq(schema.companies.id, companyId), eq(schema.companies.organizationId, session.organizationId)))
      .limit(1)
    if (!company) return { ok: false, message: 'החברה לא נמצאה.' }
  } else {
    const created = await createCompany({
      session,
      kind: 'supplier',
      data: {
        name: data.name ?? '',
        taxId: data.taxId ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.phone ?? null,
        contactEmail: data.email ?? null,
        notes: [data.address, data.city].filter(Boolean).join(', ') || null,
      },
    })
    if (!created.ok) return { ok: false, message: created.message }
    companyId = created.id
  }

  await addCompanies({ session, groupId: lead.groupId, companyIds: [companyId] })
  await getDb()
    .update(schema.projectLeads)
    .set({ status: 'approved', companyId, reviewedAt: new Date(), reviewedBy: session.userId })
    .where(eq(schema.projectLeads.id, lead.id))

  return { ok: true, companyId }
}

export async function rejectLead(session: StaffSession, leadId: string): Promise<LeadActionResult> {
  const lead = await loadLead(session, leadId)
  if (lead.status !== 'new') return { ok: false, message: 'הליד כבר טופל.' }
  await getDb()
    .update(schema.projectLeads)
    .set({ status: 'rejected', reviewedAt: new Date(), reviewedBy: session.userId })
    .where(eq(schema.projectLeads.id, lead.id))
  return { ok: true }
}

/** Corrects submitted details before approval — a typo in a phone, a name. */
export async function updateLead(
  session: StaffSession,
  leadId: string,
  values: Record<string, unknown>,
): Promise<LeadActionResult> {
  const lead = await loadLead(session, leadId)
  if (lead.status !== 'new') return { ok: false, message: 'הליד כבר טופל.' }

  const current = (lead.data ?? {}) as LeadData
  const next: LeadData = { ...current }
  for (const [key, raw] of Object.entries(values)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue
    if (typeof raw !== 'string') continue
    const value = raw.trim().slice(0, 300)
    if (value) next[key] = value
    else delete next[key]
  }
  if (!next.name) return { ok: false, message: 'חסר שם חברה.' }

  await getDb().update(schema.projectLeads).set({ data: next }).where(eq(schema.projectLeads.id, lead.id))
  return { ok: true }
}

/** Unreviewed leads across the organization — the home screen's counter. */
export async function countNewLeads(organizationId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.organizationId, organizationId), eq(schema.projectLeads.status, 'new')))
  return Number(row?.count ?? 0)
}
