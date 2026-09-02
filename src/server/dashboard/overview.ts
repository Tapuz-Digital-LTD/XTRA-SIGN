import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { countDocuments, type DocumentCounts } from '@/server/documents/queries'

/**
 * The numbers and short lists behind the home screen.
 *
 * Everything here is read-only and scoped the same way the document list is: an
 * admin sees the whole organization, anyone else sees only their own documents.
 * The point of the screen is "what needs me today", so the first list is the
 * one that is actually actionable — sent, unsigned, closest to expiry first.
 */

export type AttentionItem = {
  id: string
  title: string
  recipientName: string | null
  companyName: string | null
  sentAt: Date | null
  expiresAt: Date | null
  /** Resolved here so the page never calls Date.now() while rendering. */
  expired: boolean
  /** Whole days until the link expires; negative once it has. */
  daysLeft: number | null
}

export type SignedItem = {
  id: string
  title: string
  companyName: string | null
  completedAt: Date | null
}

export type ActivityItem = {
  agreementId: string
  title: string
  companyName: string | null
  type: string
  at: Date
}

export type DashboardOverview = {
  counts: DocumentCounts
  /** Signed since midnight, local to the server's clock. */
  signedToday: number
  /** Opened by the signer and still unsigned. */
  viewedNotSigned: number
  /** How many documents the "needs attention" filter would return. */
  attentionCount: number
  recentActivity: ActivityItem[]
  companies: { suppliers: number; customers: number }
  attention: AttentionItem[]
  attentionTotal: number
  recentlySigned: SignedItem[]
  crmLastSyncedAt: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Excludes versions something else supersedes.
 *
 * The same rule the document queries apply — repeated here because these are
 * hand-written queries against the same table rather than calls into that
 * module.
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

export async function getDashboardOverview(session: StaffSession): Promise<DashboardOverview> {
  const db = getDb()
  const now = Date.now()

  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)

  const [counts, companyRow, awaiting, signed, crmRow, todayRow, viewedRow, activity] = await Promise.all([
    countDocuments(session),

    db
      .select({
        suppliers: sql<number>`count(*) filter (where ${schema.companies.kind} = 'supplier')`,
        customers: sql<number>`count(*) filter (where ${schema.companies.kind} = 'customer')`,
      })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, session.organizationId),
          isNull(schema.companies.deletedAt),
        ),
      ),

    // Sent and still unsigned. Ordered by expiry so the ones about to lapse —
    // and the ones already lapsed — sit at the top. Nulls last: a document with
    // no expiry is never urgent.
    db
      .select({
        id: schema.agreements.id,
        title: schema.agreements.title,
        recipientName: schema.recipients.name,
        companyName: schema.companies.name,
        sentAt: schema.agreements.sentAt,
        expiresAt: schema.agreements.expiresAt,
      })
      .from(schema.agreements)
      .leftJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
      .where(and(scope(session), latestVersionOnly(), inArray(schema.agreements.status, ['sent', 'viewed'])))
      .orderBy(sql`${schema.agreements.expiresAt} asc nulls last`)
      .limit(6),

    db
      .select({
        id: schema.agreements.id,
        title: schema.agreements.title,
        companyName: schema.companies.name,
        completedAt: schema.agreements.completedAt,
      })
      .from(schema.agreements)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
      .where(and(scope(session), latestVersionOnly(), eq(schema.agreements.status, 'signed')))
      .orderBy(desc(schema.agreements.completedAt))
      .limit(5),

    db
      .select({ lastSyncedAt: schema.crmSyncState.lastSyncedAt })
      .from(schema.crmSyncState)
      .where(eq(schema.crmSyncState.organizationId, session.organizationId))
      .orderBy(desc(schema.crmSyncState.lastSyncedAt))
      .limit(1),

    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agreements)
      .where(
        and(
          scope(session),
          latestVersionOnly(),
          eq(schema.agreements.status, 'signed'),
          sql`${schema.agreements.completedAt} >= ${startOfDay}`,
        ),
      ),

    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agreements)
      .where(and(scope(session), latestVersionOnly(), eq(schema.agreements.status, 'viewed'))),

    // The last things that happened, across the organization's documents.
    db
      .select({
        agreementId: schema.auditEvents.agreementId,
        type: schema.auditEvents.type,
        at: schema.auditEvents.createdAt,
        title: schema.agreements.title,
        companyName: schema.companies.name,
      })
      .from(schema.auditEvents)
      .innerJoin(schema.agreements, eq(schema.agreements.id, schema.auditEvents.agreementId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
      .where(
        and(
          scope(session),
          inArray(schema.auditEvents.type, ['sent', 'viewed', 'completed', 'canceled', 'reminder_sent']),
        ),
      )
      .orderBy(desc(schema.auditEvents.createdAt))
      .limit(8),
  ])

  const mappedAttention = awaiting.map((r) => ({
    ...r,
    expired: r.expiresAt ? r.expiresAt.getTime() < now : false,
    daysLeft: r.expiresAt ? Math.floor((r.expiresAt.getTime() - now) / DAY_MS) : null,
  }))
  const attentionTotal = mappedAttention.length

  return {
    counts,
    signedToday: Number(todayRow[0]?.count ?? 0),
    viewedNotSigned: Number(viewedRow[0]?.count ?? 0),
    attentionCount: attentionTotal,
    recentActivity: activity.map((row) => ({
      agreementId: row.agreementId,
      title: row.title,
      companyName: row.companyName,
      type: row.type,
      at: row.at,
    })),
    companies: {
      suppliers: Number(companyRow[0]?.suppliers ?? 0),
      customers: Number(companyRow[0]?.customers ?? 0),
    },
    attention: mappedAttention,
    attentionTotal: counts.pending,
    recentlySigned: signed,
    crmLastSyncedAt: crmRow[0]?.lastSyncedAt ?? null,
  }
}
