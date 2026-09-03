import { Workbook } from 'exceljs'
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { STATUS_LABELS } from '@/lib/status'

/**
 * The one report this product needs: how the sending went.
 *
 * Everything is derived from agreements as they already are — no counters, no
 * rollups, nothing to drift. The same filter set feeds the KPI row and the
 * Excel export, so the numbers on screen and the rows in the file cannot
 * disagree.
 */

export type ReportFilters = {
  /** Restrict to documents filed under suppliers or under customers. */
  kind?: 'supplier' | 'customer'
  /** Restrict to agreements a bulk send of this project produced. */
  groupId?: string
  /** Restrict by where the company came from. */
  source?: 'crm' | 'xtra'
  /** Sent-date range, inclusive. */
  from?: Date
  to?: Date
}

export type ReportKpis = {
  sent: number
  signed: number
  pending: number
  expired: number
  canceled: number
  /** Signed out of sent, 0..100. Null when nothing was sent. */
  signRate: number | null
}

function latestVersionOnly(): SQL {
  return sql`not exists (
    select 1 from ${schema.agreements} newer
    where newer.supersedes_id = ${schema.agreements.id}
      and newer.organization_id = ${schema.agreements.organizationId}
  )`
}

function conditionsFor(session: StaffSession, filters: ReportFilters): SQL[] {
  const conditions: SQL[] = [
    eq(schema.agreements.organizationId, session.organizationId),
    latestVersionOnly(),
    // A report is about what was sent; drafts are not part of the story.
    isNotNull(schema.agreements.sentAt),
  ]
  if (filters.kind) conditions.push(eq(schema.companies.kind, filters.kind))
  if (filters.source === 'crm') conditions.push(isNotNull(schema.companies.crmRecordId))
  if (filters.source === 'xtra') conditions.push(isNull(schema.companies.crmRecordId))
  if (filters.groupId) {
    conditions.push(sql`exists (
      select 1 from ${schema.bulkBatchItems} bi
      join ${schema.bulkBatches} bb on bb.id = bi.batch_id
      where bi.agreement_id = ${schema.agreements.id}
        and bb.group_id = ${filters.groupId}
    )`)
  }
  if (filters.from) conditions.push(sql`${schema.agreements.sentAt} >= ${filters.from}`)
  if (filters.to) conditions.push(sql`${schema.agreements.sentAt} <= ${filters.to}`)
  return conditions
}

export async function agreementReport(session: StaffSession, filters: ReportFilters): Promise<ReportKpis> {
  const [row] = await getDb()
    .select({
      sent: sql<number>`count(*)`,
      signed: sql<number>`count(*) filter (where ${schema.agreements.status} = 'signed')`,
      pending: sql<number>`count(*) filter (where ${schema.agreements.status} in ('sent', 'viewed'))`,
      expired: sql<number>`count(*) filter (where ${schema.agreements.status} = 'expired')`,
      canceled: sql<number>`count(*) filter (where ${schema.agreements.status} in ('canceled', 'declined'))`,
    })
    .from(schema.agreements)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(and(...conditionsFor(session, filters)))

  const sent = Number(row?.sent ?? 0)
  const signed = Number(row?.signed ?? 0)
  return {
    sent,
    signed,
    pending: Number(row?.pending ?? 0),
    expired: Number(row?.expired ?? 0),
    canceled: Number(row?.canceled ?? 0),
    signRate: sent > 0 ? Math.round((signed / sent) * 100) : null,
  }
}

/** The same rows the KPIs counted, as a workbook someone can hand onwards. */
export async function buildReportWorkbook(session: StaffSession, filters: ReportFilters): Promise<Workbook> {
  const rows = await getDb()
    .select({
      title: schema.agreements.title,
      status: schema.agreements.status,
      sentAt: schema.agreements.sentAt,
      completedAt: schema.agreements.completedAt,
      companyName: schema.companies.name,
      companyKind: schema.companies.kind,
      crmRecordId: schema.companies.crmRecordId,
      recipientName: sql<string | null>`(
        select r.name from ${schema.recipients} r
        where r.agreement_id = ${schema.agreements.id}
        limit 1
      )`,
    })
    .from(schema.agreements)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(and(...conditionsFor(session, filters)))
    .orderBy(sql`${schema.agreements.sentAt} desc`)
    .limit(5000)

  const workbook = new Workbook()
  const sheet = workbook.addWorksheet('דוח', { views: [{ rightToLeft: true }] })
  sheet.columns = [
    { header: 'מסמך', key: 'title', width: 40 },
    { header: 'חברה', key: 'company', width: 30 },
    { header: 'סוג', key: 'kind', width: 10 },
    { header: 'מקור', key: 'source', width: 12 },
    { header: 'נמען', key: 'recipient', width: 24 },
    { header: 'סטטוס', key: 'status', width: 16 },
    { header: 'נשלח', key: 'sentAt', width: 18 },
    { header: 'נחתם', key: 'signedAt', width: 18 },
  ]
  sheet.getRow(1).font = { bold: true }

  const dateFormat = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  for (const row of rows) {
    sheet.addRow({
      title: row.title,
      company: row.companyName ?? '',
      kind: row.companyKind === 'supplier' ? 'ספק' : row.companyKind === 'customer' ? 'לקוח' : '',
      source: row.companyName ? (row.crmRecordId ? 'CRM' : 'XTRA Sign') : '',
      recipient: row.recipientName ?? '',
      status: STATUS_LABELS[row.status] ?? row.status,
      sentAt: row.sentAt ? dateFormat.format(row.sentAt) : '',
      signedAt: row.completedAt ? dateFormat.format(row.completedAt) : '',
    })
  }
  return workbook
}

/** Parses the query-string filters every reports surface shares. */
export function parseReportFilters(params: {
  kind?: string
  group?: string
  source?: string
  from?: string
  to?: string
}): ReportFilters {
  const day = (value: string | undefined, endOfDay: boolean): Date | undefined => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return {
    kind: params.kind === 'supplier' || params.kind === 'customer' ? params.kind : undefined,
    groupId: params.group && /^[0-9a-f-]{36}$/i.test(params.group) ? params.group : undefined,
    source: params.source === 'crm' || params.source === 'xtra' ? params.source : undefined,
    from: day(params.from, false),
    to: day(params.to, true),
  }
}
