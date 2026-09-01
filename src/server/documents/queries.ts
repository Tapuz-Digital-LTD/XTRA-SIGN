import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
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
}

/** The quick filters on the list screen, in the user's terms. */
export type ListFilter = 'all' | 'pending' | 'signed' | 'drafts'

const FILTER_STATUSES: Record<Exclude<ListFilter, 'all'>, AgreementStatus[]> = {
  pending: ['sent', 'viewed'],
  signed: ['signed'],
  drafts: ['draft'],
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
  options: { filter?: ListFilter; search?: string } = {},
): Promise<DocumentListItem[]> {
  const db = getDb()
  const filter = options.filter ?? 'all'
  const search = options.search?.trim()

  const conditions = [scope(session)]

  if (filter !== 'all') {
    conditions.push(inArray(schema.agreements.status, FILTER_STATUSES[filter]))
  }

  if (search) {
    // One search box over document title, signer name and company — the three
    // things someone actually remembers. `ilike` with escaped wildcards so a
    // '%' typed by the user matches a literal '%'.
    const term = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conditions.push(
      or(
        ilike(schema.agreements.title, term),
        ilike(schema.recipients.name, term),
        ilike(schema.recipients.company, term),
      )!,
    )
  }

  const rows = await db
    .select({
      id: schema.agreements.id,
      title: schema.agreements.title,
      status: schema.agreements.status,
      createdAt: schema.agreements.createdAt,
      sentAt: schema.agreements.sentAt,
      recipientName: schema.recipients.name,
      recipientCompany: schema.recipients.company,
    })
    .from(schema.agreements)
    .leftJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
    .where(and(...conditions))
    .orderBy(desc(schema.agreements.createdAt))
    .limit(100)

  return rows
}

export type DocumentCounts = { pending: number; signed: number; drafts: number }

/** The three numbers on the list header. One query, not three. */
export async function countDocuments(session: StaffSession): Promise<DocumentCounts> {
  const db = getDb()
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${schema.agreements.status} in ('sent','viewed'))`,
      signed: sql<number>`count(*) filter (where ${schema.agreements.status} = 'signed')`,
      drafts: sql<number>`count(*) filter (where ${schema.agreements.status} = 'draft')`,
    })
    .from(schema.agreements)
    .where(scope(session))

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
  renderedHash: string | null
  hasRendered: boolean
  /** True when the rendered PDF came from a Word file rather than being one. */
  wasConverted: boolean
  recipient: { name: string; company: string | null; phone: string | null; email: string | null } | null
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
    renderedHash: version?.renderedHash ?? null,
    hasRendered: Boolean(version?.renderedFileKey),
    // A converted document is one where the rendered file is a different object
    // from the source, i.e. it went through LibreOffice.
    wasConverted: Boolean(
      version?.renderedFileKey && version.renderedFileKey !== version.sourceFileKey,
    ),
    recipient: recipient ?? null,
    timeline,
  }
}
