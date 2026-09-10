import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import type { CompanyKind, CompanySource } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { submittedRegistration } from '@/server/projects/registration-rules'
import { isUuid } from '@/server/documents/authorization'
import { cleanFollowUpConfig, syncTaskTitles } from '@/server/follow-up/tasks'
import { describeCampaign, isCampaignGoal, isCampaignKind, isCampaignStatus, isEntryMethod, isRegistrationTarget, kindForEntry, type CampaignGoal, type CampaignKind, type CampaignStatus, type EntryMethod, type RegistrationTarget } from '@/lib/campaigns'

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
  campaignKind: CampaignKind
  goal: CampaignGoal
  entry: EntryMethod
  startsAt: Date | null
  endsAt: Date | null
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
  /**
   * Archived projects are off every default list; true shows only them.
   * `source` counts only that side's companies, so the chips on the XTRA Sign
   * view never count a CRM row.
   */
  options: { archived?: boolean; search?: string; campaignKind?: CampaignKind; goal?: CampaignGoal; source?: CompanySource } = {},
): Promise<GroupListItem[]> {
  const term = options.search?.trim()
  const like = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
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
      campaignKind: schema.groups.campaignKind,
      goal: schema.groups.goal,
      entryMethod: schema.groups.entryMethod,
      startsAt: schema.groups.startsAt,
      endsAt: schema.groups.endsAt,
      companyCount: sql<number>`count(${schema.companies.id})`,
    })
    .from(schema.groups)
    .leftJoin(schema.companyGroups, eq(schema.companyGroups.groupId, schema.groups.id))
    .leftJoin(
      schema.companies,
      and(
        eq(schema.companies.id, schema.companyGroups.companyId),
        isNull(schema.companies.deletedAt),
        isNull(schema.companies.archivedAt),
        options.source === 'crm' ? isNotNull(schema.companies.crmRecordId) : undefined,
        options.source === 'xtra' ? isNull(schema.companies.crmRecordId) : undefined,
      ),
    )
    .where(
      and(
        eq(schema.groups.organizationId, session.organizationId),
        isNull(schema.groups.deletedAt),
        options.archived ? isNotNull(schema.groups.archivedAt) : isNull(schema.groups.archivedAt),
        // Internal contexts (direct signings) are never listed as campaigns.
        isNull(schema.groups.systemKey),
        kind ? or(eq(schema.groups.kind, kind), isNull(schema.groups.kind)) : undefined,
        options.campaignKind ? eq(schema.groups.campaignKind, options.campaignKind) : undefined,
        options.goal ? eq(schema.groups.goal, options.goal) : undefined,
        like
          ? sql`(${schema.groups.name} ilike ${like} or ${schema.groups.description} ilike ${like})`
          : undefined,
      ),
    )
    .groupBy(
      schema.groups.id,
      schema.groups.name,
      schema.groups.description,
      schema.groups.createdAt,
      schema.groups.kind,
      schema.groups.campaignKind,
      schema.groups.goal,
      schema.groups.entryMethod,
      schema.groups.startsAt,
      schema.groups.endsAt,
    )
    .orderBy(desc(schema.groups.createdAt))

  return rows.map((row) => ({
    ...row,
    kind: (row.kind as 'supplier' | 'customer' | null) ?? null,
    campaignKind: isCampaignKind(row.campaignKind) ? row.campaignKind : 'signature',
    ...describeCampaign({ goal: row.goal, entryMethod: row.entryMethod, campaignKind: row.campaignKind }),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    companyCount: Number(row.companyCount),
  }))
}

export type ProjectListItem = GroupListItem & {
  /** Suppliers whose latest send from this project ended signed. */
  signed: number
  /** Suppliers whose latest send is still waiting (sent/viewed). */
  pending: number
  /** People who came through the public door. */
  registrations: number
  lastActivityAt: Date | null
}

/**
 * The projects screen's list: each project with what a glance needs — how many
 * suppliers, how the sending is going, and when anything last moved. Counts
 * are per supplier (the latest word per company), matching the tracking tab.
 */
export async function listProjects(
  session: StaffSession,
  options: { archived?: boolean; search?: string; campaignKind?: CampaignKind; goal?: CampaignGoal } = {},
): Promise<ProjectListItem[]> {
  const groups = await listGroups(session, undefined, options)
  if (groups.length === 0) return []

  const registrationRows = await getDb()
    .select({ groupId: schema.projectLeads.groupId, n: sql<number>`count(*)` })
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.organizationId, session.organizationId), submittedRegistration()))
    .groupBy(schema.projectLeads.groupId)
  const registrations = new Map(registrationRows.map((r) => [r.groupId, Number(r.n)]))

  const stats = await getDb().execute(sql`
    select group_id,
      count(*) filter (where status = 'signed') as signed,
      count(*) filter (where status in ('sent', 'viewed')) as pending,
      max(updated_at) as last_activity
    from (
      select distinct on (bb.group_id, bi.company_id)
        bb.group_id, bi.company_id,
        coalesce(a.status::text, bi.status) as status,
        bi.updated_at
      from ${schema.bulkBatchItems} bi
      join ${schema.bulkBatches} bb on bb.id = bi.batch_id
      left join ${schema.agreements} a on a.id = bi.agreement_id
      where bb.organization_id = ${session.organizationId}
      order by bb.group_id, bi.company_id, bi.updated_at desc
    ) latest
    group by group_id
  `)

  const byGroup = new Map<string, { signed: number; pending: number; lastActivityAt: Date | null }>()
  for (const row of stats.rows as { group_id: string; signed: string; pending: string; last_activity: Date | null }[]) {
    byGroup.set(row.group_id, {
      signed: Number(row.signed),
      pending: Number(row.pending),
      lastActivityAt: row.last_activity ? new Date(row.last_activity) : null,
    })
  }

  return groups.map((group) => ({
    ...group,
    signed: byGroup.get(group.id)?.signed ?? 0,
    pending: byGroup.get(group.id)?.pending ?? 0,
    registrations: registrations.get(group.id) ?? 0,
    lastActivityAt: byGroup.get(group.id)?.lastActivityAt ?? null,
  }))
}

/** Off the main screen; nothing is deleted and one click brings it back. */
export async function setProjectArchived(
  session: StaffSession,
  groupId: string,
  archived: boolean,
): Promise<{ ok: true }> {
  const group = await authorizeGroup(session, groupId)
  await getDb()
    .update(schema.groups)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(schema.groups.id, group.id))
  return { ok: true }
}

export type CampaignFields = {
  campaignKind?: CampaignKind
  goal?: CampaignGoal
  entryMethod?: EntryMethod
  registrationTarget?: RegistrationTarget
  status?: CampaignStatus
  endedMessage?: string | null
  allowCompletionAfterEnd?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
  registrationsAfterEnd?: boolean
  linkTtlDays?: number
  ownerUserId?: string | null
  defaultTemplateId?: string | null
  /** The tasks a signature opens, in order: { afterSign: [{ key, label }] }. */
  followUpConfig?: unknown
}

function cleanCampaignFields(input: CampaignFields) {
  const out: Partial<typeof schema.groups.$inferInsert> = {}
  if (input.campaignKind !== undefined && isCampaignKind(input.campaignKind)) out.campaignKind = input.campaignKind
  if (input.goal !== undefined && isCampaignGoal(input.goal)) out.goal = input.goal
  if (input.registrationTarget !== undefined && isRegistrationTarget(input.registrationTarget)) out.registrationTarget = input.registrationTarget
  if (input.status !== undefined && isCampaignStatus(input.status)) out.status = input.status
  if (input.endedMessage !== undefined) out.endedMessage = input.endedMessage ? String(input.endedMessage).trim().slice(0, 600) || null : null
  if (input.allowCompletionAfterEnd !== undefined) out.allowCompletionAfterEnd = Boolean(input.allowCompletionAfterEnd)
  if (input.entryMethod !== undefined && isEntryMethod(input.entryMethod)) {
    out.entryMethod = input.entryMethod
    out.campaignKind = kindForEntry(input.entryMethod)
  }
  if (input.startsAt !== undefined) out.startsAt = input.startsAt
  if (input.endsAt !== undefined) out.endsAt = input.endsAt
  if (input.registrationsAfterEnd !== undefined) out.registrationsAfterEnd = Boolean(input.registrationsAfterEnd)
  if (input.linkTtlDays !== undefined) out.linkTtlDays = Number.isInteger(input.linkTtlDays) && input.linkTtlDays >= 1 && input.linkTtlDays <= 365 ? input.linkTtlDays : 30
  if (input.ownerUserId !== undefined) out.ownerUserId = input.ownerUserId && isUuid(input.ownerUserId) ? input.ownerUserId : null
  if (input.defaultTemplateId !== undefined) out.defaultTemplateId = input.defaultTemplateId && isUuid(input.defaultTemplateId) ? input.defaultTemplateId : null
  if (input.followUpConfig !== undefined) out.followUpConfig = cleanFollowUpConfig(input.followUpConfig)
  return out
}

export async function createGroup(input: {
  session: StaffSession
  name: string
  description?: string | null
  kind?: 'supplier' | 'customer' | null
  /** Seed membership, for "create a group from this selection". */
  companyIds?: string[]
} & CampaignFields): Promise<GroupResult> {
  const name = cleanName(input.name)
  if (!name) return { ok: false, message: 'יש להזין שם לקמפיין.' }
  if (input.startsAt && input.endsAt && input.endsAt.getTime() < input.startsAt.getTime()) return { ok: false, message: 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה.' }

  const [group] = await getDb()
    .insert(schema.groups)
    .values({
      organizationId: input.session.organizationId,
      name,
      description: input.description?.trim().slice(0, 2000) || null,
      kind: input.kind === 'supplier' || input.kind === 'customer' ? input.kind : null,
      createdBy: input.session.userId,
      ownerUserId: input.session.userId,
      ...cleanCampaignFields(input),
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

/** The campaign's own settings — kind, dates, link lifetime, owner, default agreement. */
export async function updateCampaign(session: StaffSession, groupId: string, input: CampaignFields & { name?: string; description?: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const group = await authorizeGroup(session, groupId)
  const patch: Partial<typeof schema.groups.$inferInsert> = cleanCampaignFields(input)
  if (input.name !== undefined) {
    const name = cleanName(input.name)
    if (!name) return { ok: false, message: 'יש להזין שם לקמפיין.' }
    patch.name = name
  }
  if (input.description !== undefined) patch.description = input.description?.trim().slice(0, 2000) || null
  const startsAt = patch.startsAt !== undefined ? patch.startsAt : group.startsAt
  const endsAt = patch.endsAt !== undefined ? patch.endsAt : group.endsAt
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) return { ok: false, message: 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה.' }
  if (patch.ownerUserId) {
    const [owner] = await getDb().select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, patch.ownerUserId), eq(schema.users.organizationId, session.organizationId))).limit(1)
    if (!owner) return { ok: false, message: 'הבעלים שנבחר לא נמצא.' }
  }
  if (patch.defaultTemplateId) {
    const [template] = await getDb().select({ id: schema.templates.id }).from(schema.templates).where(and(eq(schema.templates.id, patch.defaultTemplateId), eq(schema.templates.organizationId, session.organizationId), isNull(schema.templates.deletedAt))).limit(1)
    if (!template) return { ok: false, message: 'התבנית שנבחרה לא נמצאה.' }
  }
  await getDb().update(schema.groups).set(patch).where(eq(schema.groups.id, group.id))
  // A task that was renamed is renamed on the board too, not only for the
  // signatures still to come.
  if (patch.followUpConfig) await syncTaskTitles(group.id, (patch.followUpConfig as { afterSign: { key: string; label: string }[] }).afterSign)
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
  address: string | null
  fromCrm: boolean
  /** Whether a bulk send could reach this company without someone filling something in. */
  readyToSend: boolean
  /**
   * What last happened to this company in THIS project: the newest agreement a
   * batch of this project produced for it, or the failure that produced none.
   * Null means nothing was ever sent from here.
   */
  lastSend: { agreementId: string | null; status: string; at: Date } | null
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

  const [rows, sends] = await Promise.all([
    getDb()
      .select({
        id: schema.companies.id,
        name: schema.companies.name,
        kind: schema.companies.kind,
        taxId: schema.companies.taxId,
        contactName: schema.companies.contactName,
        contactPhone: schema.companies.contactPhone,
        contactEmail: schema.companies.contactEmail,
        address: schema.companies.address,
        crmRecordId: schema.companies.crmRecordId,
      })
      .from(schema.companyGroups)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.companyGroups.companyId))
      .where(and(...conditions))
      .orderBy(schema.companies.name)
      .limit(1000),

    // Every batch row this project ever produced, newest last so the reduce
    // below keeps the latest word per company.
    getDb()
      .select({
        companyId: schema.bulkBatchItems.companyId,
        itemStatus: schema.bulkBatchItems.status,
        agreementId: schema.bulkBatchItems.agreementId,
        updatedAt: schema.bulkBatchItems.updatedAt,
        agreementStatus: schema.agreements.status,
      })
      .from(schema.bulkBatchItems)
      .innerJoin(schema.bulkBatches, eq(schema.bulkBatches.id, schema.bulkBatchItems.batchId))
      .leftJoin(schema.agreements, eq(schema.agreements.id, schema.bulkBatchItems.agreementId))
      .where(eq(schema.bulkBatches.groupId, group.id))
      .orderBy(schema.bulkBatchItems.updatedAt),
  ])

  const lastSendByCompany = new Map<string, GroupCompany['lastSend']>()
  for (const send of sends) {
    lastSendByCompany.set(send.companyId, {
      agreementId: send.agreementId,
      // The agreement's own status once one exists; before that, the batch
      // row's word ('failed' being the one worth showing).
      status: send.agreementStatus ?? send.itemStatus,
      at: send.updatedAt,
    })
  }

  // Agreements the project's self-service flow created (ADR 0001) never went
  // through a batch; they carry the project on their snapshot instead. The
  // newest word per company wins, whichever door it came through.
  const selfService = await getDb()
    .select({
      companyId: schema.agreements.companyId,
      agreementId: schema.agreements.id,
      status: schema.agreements.status,
      at: schema.agreements.createdAt,
    })
    .from(schema.agreements)
    .where(
      and(
        eq(schema.agreements.organizationId, session.organizationId),
        sql`${schema.agreements.mergeSnapshot}->'selfService'->>'projectId' = ${group.id}`,
      ),
    )
    .orderBy(schema.agreements.createdAt)
  for (const row of selfService) {
    if (!row.companyId) continue
    const current = lastSendByCompany.get(row.companyId)
    if (current && current.at > row.at) continue
    lastSendByCompany.set(row.companyId, { agreementId: row.agreementId, status: row.status, at: row.at })
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    taxId: row.taxId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    address: row.address,
    fromCrm: Boolean(row.crmRecordId),
    // A signer needs a name, and somewhere to send the link.
    readyToSend: Boolean(row.contactName?.trim() && (row.contactPhone || row.contactEmail)),
    lastSend: lastSendByCompany.get(row.id) ?? null,
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
