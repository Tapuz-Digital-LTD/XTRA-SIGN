import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import type { AgreementStatus } from '@/lib/status'

/**
 * Read models for the documents screens.
 *
 * Every query filters on organizationId, and a non-admin additionally on
 * ownerId — the same rule authorizeAgreementAccess enforces for a single
 * document, applied to lists. A list that leaks a title is as much a breach as
 * one that leaks the file.
 */

export type DocumentListItem = {
  id: string
  title: string
  status: AgreementStatus
  createdAt: Date
  sentAt: Date | null
  recipientName: string | null
  recipientCompany: string | null
  /** Set when the document was imported from the CRM. */
  crmDocumentId: string | null
  /** The supplier/customer it is filed under. Null for older documents. */
  company: { id: string; name: string; kind: 'supplier' | 'customer'; fromCrm: boolean } | null
  recipientPhone: string | null
  recipientEmail: string | null
  createdByName: string | null
  /** How it came to exist. Null on rows created before this was recorded. */
  sourceKind: string | null
  /** The most recent thing that happened to it, for one human date column. */
  lastActivityAt: Date
  /** The last audit event type, so the date can be worded ("נחתם", "נצפה"). */
  lastActivityType: string | null
  /** True when a send attempt is on record as having failed. */
  hasSendFailure: boolean
  /** How many versions this document has had, counting itself. */
  versionCount: number
  expiresAt: Date | null
}

/** The quick filters on the list screen, in the user's terms. */
export type ListFilter =
  | 'all'
  | 'drafts'
  | 'pending'
  | 'viewed'
  | 'signed'
  | 'expired'
  | 'canceled'
  | 'attention'

const FILTER_STATUSES: Record<'pending' | 'signed' | 'drafts' | 'viewed' | 'expired' | 'canceled', AgreementStatus[]> = {
  pending: ['sent', 'viewed'],
  viewed: ['viewed'],
  signed: ['signed'],
  drafts: ['draft'],
  expired: ['expired'],
  canceled: ['canceled', 'declined'],
}

/**
 * How long a viewed-but-unsigned document waits before it counts as stuck.
 * The same threshold the reminder job uses, so the screen and the reminders
 * cannot disagree about what "waiting too long" means.
 */
const STALE_AFTER_DAYS = 3

/**
 * Excludes a version that something else supersedes.
 *
 * A version chain is one document. Counting every version separately inflates
 * every number built on it — the dashboard tiles, the "ועוד N" line, the
 * company page — into saying there are four agreements where there is one.
 */
function latestVersionOnly() {
  return sql`not exists (
    select 1 from ${schema.agreements} newer
    where newer.supersedes_id = ${schema.agreements.id}
      and newer.organization_id = ${schema.agreements.organizationId}
  )`
}

function scope(session: StaffSession) {
  return session.isAdmin
    ? eq(schema.agreements.organizationId, session.organizationId)
    : and(
        eq(schema.agreements.organizationId, session.organizationId),
        eq(schema.agreements.ownerId, session.userId),
      )
}

export async function listDocuments(
  session: StaffSession,
  options: {
    filter?: ListFilter
    search?: string
    companyId?: string
    /** Only agreements a bulk send of this project produced. */
    groupId?: string
    page?: number
    pageSize?: number
    /** Show superseded versions as their own rows. Off by default. */
    includeSuperseded?: boolean
  } = {},
): Promise<{ items: DocumentListItem[]; total: number; page: number; pageSize: number; now: number }> {
  const db = getDb()
  // Read here rather than in the page: a clock read during render makes the
  // render impure, and "how long ago" has to be measured from somewhere.
  const now = Date.now()
  const filter = options.filter ?? 'all'
  const search = options.search?.trim()
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100)
  const page = Math.max(options.page ?? 1, 1)

  const conditions = [scope(session)]

  // A version chain is one document, not several. A row that something else
  // supersedes is history: it stays reachable from the document it became, but
  // listing every version separately turns one agreement into four rows that
  // all look alike.
  if (!options.includeSuperseded) conditions.push(latestVersionOnly())

  if (options.companyId) {
    conditions.push(eq(schema.agreements.companyId, options.companyId))
  }

  if (options.groupId) {
    conditions.push(sql`exists (
      select 1 from ${schema.bulkBatchItems} bi
      join ${schema.bulkBatches} bb on bb.id = bi.batch_id
      where bi.agreement_id = ${schema.agreements.id}
        and bb.group_id = ${options.groupId}
    )`)
  }

  if (filter !== 'all' && filter !== 'attention') {
    conditions.push(inArray(schema.agreements.status, FILTER_STATUSES[filter]))
  }

  // "Needs attention" is a question about the data, not a status someone sets.
  // Everything here is derivable from what the system already records — no
  // event was invented to make the tab work.
  if (filter === 'attention') {
    const stale = sql`now() - ${sql.raw(`interval '${STALE_AFTER_DAYS} days'`)}`
    conditions.push(
      or(
        // Filed under nobody, so it is only ever findable in this list.
        isNull(schema.agreements.companyId),
        // The signing link has run out while the document was still open.
        and(
          inArray(schema.agreements.status, ['sent', 'viewed']),
          isNotNull(schema.agreements.expiresAt),
          lt(schema.agreements.expiresAt, sql`now()`),
        ),
        // Opened, then nothing — for at least as long as a reminder waits.
        and(eq(schema.agreements.status, 'viewed'), lt(schema.agreements.sentAt, stale)),
        // A delivery attempt is on record as having failed.
        sql`exists (
          select 1 from ${schema.auditEvents} ae
          where ae.agreement_id = ${schema.agreements.id}
            and ae.type in ('email_failed', 'sms_failed')
        )`,
      )!,
    )
  }

  if (search) {
    // One box over what someone actually remembers about a document: what it
    // was called, which company it was for, and who signed it — including the
    // phone or email it was sent to, which is often the only thing to hand.
    // `ilike` with escaped wildcards, so a '%' typed by the user is a literal.
    const escape = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const term = escape(search)

    // Phones are stored E.164 (+9725…) but nobody searches that way — they
    // type the 05… number they know. Match both forms.
    const asE164 = normalizeIsraeliPhone(search)
    const phoneTerms = [ilike(schema.recipients.phone, term)]
    if (asE164) phoneTerms.push(ilike(schema.recipients.phone, escape(asE164)))

    conditions.push(
      or(
        ilike(schema.agreements.title, term),
        ilike(schema.recipients.name, term),
        ilike(schema.recipients.company, term),
        ilike(schema.recipients.email, term),
        ilike(schema.companies.name, term),
        ...phoneTerms,
      )!,
    )
  }

  const where = and(...conditions)

  // The newest audit row per document, which is what "last activity" means to
  // a person: sent, viewed, signed — not just when the row was inserted.
  const activity = db
    .select({
      agreementId: schema.auditEvents.agreementId,
      lastAt: sql<Date>`max(${schema.auditEvents.createdAt})`.as('last_at'),
    })
    .from(schema.auditEvents)
    .groupBy(schema.auditEvents.agreementId)
    .as('activity')

  const base = db
    .select({
      id: schema.agreements.id,
      title: schema.agreements.title,
      status: schema.agreements.status,
      createdAt: schema.agreements.createdAt,
      sentAt: schema.agreements.sentAt,
      expiresAt: schema.agreements.expiresAt,
      crmDocumentId: schema.agreements.crmDocumentId,
      sourceKind: schema.agreements.sourceKind,
      recipientName: schema.recipients.name,
      recipientCompany: schema.recipients.company,
      recipientPhone: schema.recipients.phone,
      recipientEmail: schema.recipients.email,
      companyId: schema.companies.id,
      companyName: schema.companies.name,
      companyKind: schema.companies.kind,
      companyCrmRecordId: schema.companies.crmRecordId,
      createdByName: schema.users.name,
      lastAt: activity.lastAt,
      hasSendFailure: sql<boolean>`exists (
        select 1 from ${schema.auditEvents} ae
        where ae.agreement_id = ${schema.agreements.id}
          and ae.type in ('email_failed', 'sms_failed')
      )`,
      versionCount: sql<number>`(
        with recursive chain as (
          select ${schema.agreements.id} as id, ${schema.agreements.supersedesId} as prev
          union all
          select a.id, a.supersedes_id from ${schema.agreements} a join chain on a.id = chain.prev
        ) select count(*) from chain
      )`,
      lastActivityType: sql<string | null>`(
        select ae.type from ${schema.auditEvents} ae
        where ae.agreement_id = ${schema.agreements.id}
        order by ae.created_at desc limit 1
      )`,
    })
    .from(schema.agreements)
    .leftJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .leftJoin(schema.users, eq(schema.users.id, schema.agreements.ownerId))
    .leftJoin(activity, eq(activity.agreementId, schema.agreements.id))
    .where(where)

  // Counted with the same joins and the same filter, so the total the pager
  // shows is the total the query would return.
  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.agreements)
    .leftJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(where)

  const rows = await base
    // A stable tiebreaker: documents with no events share a timestamp, and
    // without a second key the database is free to order ties differently per
    // query — which makes page 2 repeat rows page 1 already showed.
    .orderBy(desc(sql`coalesce(${activity.lastAt}, ${schema.agreements.createdAt})`), desc(schema.agreements.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      expiresAt: row.expiresAt,
      recipientName: row.recipientName,
      recipientCompany: row.recipientCompany,
      recipientPhone: row.recipientPhone,
      recipientEmail: row.recipientEmail,
      crmDocumentId: row.crmDocumentId,
      sourceKind: row.sourceKind,
      createdByName: row.createdByName,
      company: row.companyId
        ? {
            id: row.companyId,
            name: row.companyName!,
            kind: row.companyKind!,
            fromCrm: Boolean(row.companyCrmRecordId),
          }
        : null,
      // The aggregate comes back from the driver as a timestamp string — the
      // `sql<Date>` annotation is a compile-time claim, not a runtime one.
      lastActivityAt: row.lastAt ? new Date(row.lastAt) : row.createdAt,
      lastActivityType: row.lastActivityType,
      hasSendFailure: Boolean(row.hasSendFailure),
      versionCount: Number(row.versionCount ?? 1),
    })),
    total: Number(countRow?.total ?? 0),
    page,
    pageSize,
    now,
  }
}

export type DocumentCounts = { pending: number; signed: number; drafts: number }

/** The three numbers on the list header. One query, not three. */
export async function countDocuments(
  session: StaffSession,
  options: { companyId?: string } = {},
): Promise<DocumentCounts> {
  const db = getDb()
  const where = options.companyId
    ? and(scope(session), latestVersionOnly(), eq(schema.agreements.companyId, options.companyId))
    : and(scope(session), latestVersionOnly())
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${schema.agreements.status} in ('sent','viewed'))`,
      signed: sql<number>`count(*) filter (where ${schema.agreements.status} = 'signed')`,
      drafts: sql<number>`count(*) filter (where ${schema.agreements.status} = 'draft')`,
    })
    .from(schema.agreements)
    .where(where)

  return {
    pending: Number(row?.pending ?? 0),
    signed: Number(row?.signed ?? 0),
    drafts: Number(row?.drafts ?? 0),
  }
}

export type DocumentDetail = {
  id: string
  title: string
  status: AgreementStatus
  createdAt: Date
  sentAt: Date | null
  completedAt: Date | null
  pageCount: number | null
  /** Per-page geometry, for the pdf.js preview to reserve the right boxes. */
  pages: { pageNumber: number; widthPt: number; heightPt: number }[]
  renderedHash: string | null
  hasRendered: boolean
  /** True when the rendered PDF came from a Word file rather than being one. */
  wasConverted: boolean
  recipient: { name: string; company: string | null; phone: string | null; email: string | null } | null
  /** The supplier/customer this document is filed under, for a link back. */
  company: { id: string; name: string; kind: 'supplier' | 'customer' } | null
  /** When the signing link expires, if the document has been sent. */
  expiresAt: Date | null
  /** Whether that expiry is already in the past, resolved at request time. */
  linkExpired: boolean
  /** Imported from Fireberry rather than uploaded here. */
  fromCrm: boolean
  /** The CRM record this document was made from, when it was. */
  crmRecordId: string | null
  /** done | failed | null — pushing the signed PDF back to that record. */
  crmWritebackState: 'done' | 'failed' | null
  timeline: { type: string; createdAt: Date }[]
}

/**
 * Detail for one document. Takes an already-authorized agreement rather than an
 * id, so this function cannot be called without the check having happened.
 */
export async function getDocumentDetail(agreementId: string): Promise<DocumentDetail | null> {
  const db = getDb()

  const [agreement] = await db
    .select()
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)

  if (!agreement) return null

  const versions = await db
    .select()
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.agreementId, agreementId))
    .orderBy(desc(schema.agreementVersions.versionNumber))
    .limit(1)

  const [recipient] = await db
    .select({
      name: schema.recipients.name,
      company: schema.recipients.company,
      phone: schema.recipients.phone,
      email: schema.recipients.email,
    })
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreementId))
    .limit(1)

  const [company] = agreement.companyId
    ? await db
        .select({
          id: schema.companies.id,
          name: schema.companies.name,
          kind: schema.companies.kind,
        })
        .from(schema.companies)
        .where(eq(schema.companies.id, agreement.companyId))
        .limit(1)
    : []

  const pages = versions[0]
    ? await db
        .select({
          pageNumber: schema.documentPages.pageNumber,
          widthPt: schema.documentPages.widthPt,
          heightPt: schema.documentPages.heightPt,
        })
        .from(schema.documentPages)
        .where(eq(schema.documentPages.agreementVersionId, versions[0].id))
        .orderBy(schema.documentPages.pageNumber)
    : []

  const timeline = await db
    .select({ type: schema.auditEvents.type, createdAt: schema.auditEvents.createdAt })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.agreementId, agreementId))
    .orderBy(schema.auditEvents.createdAt)

  const version = versions[0]

  return {
    id: agreement.id,
    title: agreement.title,
    status: agreement.status,
    createdAt: agreement.createdAt,
    sentAt: agreement.sentAt,
    completedAt: agreement.completedAt,
    pageCount: version?.pageCount ?? null,
    pages,
    renderedHash: version?.renderedHash ?? null,
    hasRendered: Boolean(version?.renderedFileKey),
    // A converted document is one where the rendered file is a different object
    // from the source, i.e. it went through LibreOffice.
    wasConverted: Boolean(
      version?.renderedFileKey && version.renderedFileKey !== version.sourceFileKey,
    ),
    recipient: recipient ?? null,
    company: company ?? null,
    expiresAt: agreement.expiresAt,
    linkExpired: agreement.expiresAt ? agreement.expiresAt.getTime() < Date.now() : false,
    fromCrm: Boolean(agreement.crmDocumentId || agreement.crmRecordId),
    crmRecordId: agreement.crmRecordId,
    crmWritebackState: (agreement.crmWritebackState as 'done' | 'failed' | null) ?? null,
    timeline,
  }
}
