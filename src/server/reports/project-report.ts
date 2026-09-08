import { Workbook } from 'exceljs'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { classifySource, type Utm } from '@/lib/campaign-events'
import { formatDuration } from '@/lib/format-duration'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { submittedRegistration } from '@/server/projects/registration-rules'
import { summarizeTask, type TaskSummary } from '@/server/follow-up/labels'
import { tasksForLeads } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { selfServiceOf } from '@/server/projects/self-service'

/**
 * A project's report: the whole path from a page view to a signature.
 *
 * Registrations and agreements are counted from their own tables — they are
 * the record. Page views, clicks and "started" moments come from the
 * campaign events the pages emit, and only exist from the day those began;
 * the report says so rather than showing a zero that means "not measured".
 * Everything is aggregated in SQL against indexed columns, so the screen
 * stays quick as events pile up. The same filters feed the numbers, the
 * rows and the Excel file.
 */

export type StatusFilter = 'signed' | 'pending' | 'expired' | 'failed' | 'attention' | 'registered'

export type ProjectReportFilters = {
  from?: Date
  to?: Date
  status?: StatusFilter
  /** A traffic-source key from `classifySource`. */
  source?: string
  /** Free text over the business name, contact, tax id, phone, email. */
  q?: string
}

export type Kpi = { value: number; previous: number | null }

export type FunnelStage = { key: string; label: string; count: number; fromEvents: boolean }

export type RegistrationRow = {
  id: string
  createdAt: Date
  businessName: string
  taxId: string
  contactName: string
  phone: string
  email: string
  source: { key: string; label: string; medium: string | null }
  campaign: string | null
  registrationStatus: string
  /** Human label the screen shows. */
  statusLabel: string
  statusTone: 'ok' | 'wait' | 'muted' | 'bad'
  companyId: string | null
  agreement: { id: string; status: string; sentAt: Date | null; completedAt: Date | null } | null
  /** Registration → signature, in seconds. */
  secondsToSign: number | null
  /** The follow-up task a signature created, when the campaign asks for one. */
  task: TaskSummary | null
  /** Saved on a local row because the CRM had no single match: a person should link it. */
  linkingNeeded: boolean
  /** Staff follow-up on the registration itself. */
  followUp: { assigneeUserId: string | null; followUpAt: string | null; callOutcome: string | null; internalNote: string | null }
}

export type ProjectReport = {
  hasCampaignPage: boolean
  /** The first day traffic was measured; null when nothing was measured yet. */
  trafficSince: Date | null
  kpis: {
    visits: Kpi
    registrations: Kpi
    agreements: Kpi
    signed: Kpi
    pending: Kpi
    /** Signed out of registrations, 0..100; null without registrations. */
    completionRate: number | null
  }
  funnel: FunnelStage[]
  conversion: { visitToRegistration: number | null; registrationToSignature: number | null }
  timeline: { granularity: 'day' | 'week'; points: { bucket: string; visits: number; registrations: number; signatures: number }[] }
  statuses: { key: string; label: string; count: number }[]
  sources: { key: string; label: string; medium: string | null; visits: number; registrations: number; signatures: number; conversion: number | null }[]
  registrations: RegistrationRow[]
  registrationTotal: number
}

const STATUS_SETS: Record<StatusFilter, SQL> = {
  signed: sql`a.status = 'signed'`,
  pending: sql`a.status in ('sent', 'viewed')`,
  expired: sql`a.status = 'expired'`,
  failed: sql`(${schema.projectLeads.status} = 'failed' or a.status in ('canceled', 'declined'))`,
  /** A person must act: a lead waiting for approval. */
  attention: sql`(${schema.projectLeads.status} = 'new' or ${schema.projectLeads.meta}->>'linking' = 'needed')`,
  /** Registered, no agreement (yet): saved for handling, approved, or in progress. */
  registered: sql`(a.id is null and ${schema.projectLeads.status} <> 'failed')`,
}

const STATUS_LABELS: Record<string, { label: string; tone: RegistrationRow['statusTone'] }> = {
  signed: { label: 'נחתם', tone: 'ok' },
  viewed: { label: 'צפה בהסכם', tone: 'wait' },
  sent: { label: 'ממתין לחתימה', tone: 'wait' },
  draft: { label: 'ממתין לחתימה', tone: 'wait' },
  expired: { label: 'פג תוקף', tone: 'muted' },
  canceled: { label: 'בוטל', tone: 'muted' },
  declined: { label: 'סורב', tone: 'bad' },
  failed: { label: 'שליחה נכשלה', tone: 'bad' },
  pending: { label: 'בתהליך', tone: 'wait' },
  new: { label: 'דורש טיפול', tone: 'wait' },
  invited: { label: 'הוזמן', tone: 'muted' },
  approved: { label: 'אושר', tone: 'ok' },
  converted: { label: 'נרשם', tone: 'ok' },
  rejected: { label: 'נדחה', tone: 'muted' },
}

function statusOf(leadStatus: string, agreementStatus: string | null) {
  if (leadStatus === 'failed') return { key: 'failed', ...STATUS_LABELS.failed }
  if (agreementStatus) return { key: agreementStatus, ...(STATUS_LABELS[agreementStatus] ?? { label: agreementStatus, tone: 'muted' as const }) }
  return { key: leadStatus, ...(STATUS_LABELS[leadStatus] ?? { label: leadStatus, tone: 'muted' as const }) }
}

/** The source of a lead, from what it carried. */
function leadSource(meta: unknown, referrer: string | null) {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  const utm: Utm = {}
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) {
    if (typeof m[key] === 'string') utm[key] = m[key] as string
  }
  return { source: classifySource(utm, referrer), campaign: typeof m.utm_campaign === 'string' ? (m.utm_campaign as string) : null }
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)

export async function projectReport(session: StaffSession, projectId: string, filters: ProjectReportFilters, rowLimit = 200): Promise<ProjectReport> {
  const group = await authorizeGroup(session, projectId)
  const db = getDb()
  const hasCampaignPage = Boolean(selfServiceOf(group.landingConfig).skin)
  const range = { from: filters.from, to: filters.to }

  const [trafficSinceRow] = await db
    .select({ since: sql<Date | null>`min(${schema.campaignEvents.createdAt})` })
    .from(schema.campaignEvents)
    .where(eq(schema.campaignEvents.groupId, group.id))
  const trafficSince = trafficSinceRow?.since ? new Date(trafficSinceRow.since) : null

  const previous = rangeBefore(range)
  const [current, before, rows, total] = await Promise.all([
    counts(group.id, range, filters.source),
    previous ? counts(group.id, previous, filters.source) : null,
    registrationRows(group.id, filters, rowLimit),
    countRegistrations(group.id, filters),
  ])

  const kpi = (key: keyof typeof current): Kpi => ({ value: current[key], previous: before ? before[key] : null })

  const funnel: FunnelStage[] = [
    { key: 'visits', label: 'נכנסו לעמוד', count: current.visits, fromEvents: true },
    { key: 'cta', label: 'לחצו להצטרפות', count: current.ctaClicks, fromEvents: true },
    { key: 'started', label: 'התחילו למלא', count: current.started, fromEvents: true },
    { key: 'registered', label: 'השלימו הרשמה', count: current.registrations, fromEvents: false },
    { key: 'signing', label: 'התחילו חתימה', count: current.signingStarted, fromEvents: true },
    { key: 'signed', label: 'חתמו', count: current.signed, fromEvents: false },
  ]

  return {
    hasCampaignPage,
    trafficSince,
    kpis: {
      visits: kpi('visits'),
      registrations: kpi('registrations'),
      agreements: kpi('agreements'),
      signed: kpi('signed'),
      pending: kpi('pending'),
      completionRate: rate(current.signed, current.registrations),
    },
    funnel: hasCampaignPage ? funnel : funnel.filter((s) => !s.fromEvents),
    conversion: {
      visitToRegistration: rate(current.registrations, current.visits),
      registrationToSignature: rate(current.signed, current.registrations),
    },
    timeline: await timeline(group.id, range, filters.source),
    statuses: await statusBreakdown(group.id, range, filters.source),
    sources: hasCampaignPage ? await sources(group.id, range) : [],
    registrations: rows,
    registrationTotal: total,
  }
}

/** The same length of time, immediately before the range — only for a bounded range. */
function rangeBefore(range: { from?: Date; to?: Date }): { from: Date; to: Date } | null {
  if (!range.from) return null
  const to = range.to ?? new Date()
  const length = to.getTime() - range.from.getTime()
  if (length <= 0) return null
  return { from: new Date(range.from.getTime() - length), to: new Date(range.from.getTime() - 1) }
}

function within(column: SQL, range: { from?: Date; to?: Date }): SQL {
  const parts: SQL[] = []
  if (range.from) parts.push(sql`${column} >= ${range.from}`)
  if (range.to) parts.push(sql`${column} <= ${range.to}`)
  return parts.length ? sql.join(parts, sql` and `) : sql`true`
}

/** The leads whose source matches — a JS classification pushed down as a filter on the raw tags. */
function sourceMatch(source: string | undefined, utmSource: SQL, referrer: SQL): SQL {
  if (!source) return sql`true`
  if (source === 'direct') return sql`(coalesce(${utmSource}, '') = '' and coalesce(${referrer}, '') = '')`
  if (source.startsWith('utm:')) return sql`lower(${utmSource}) = ${source.slice(4)}`
  if (source.startsWith('ref:')) return sql`(coalesce(${utmSource}, '') = '' and ${referrer} ilike ${'%' + source.slice(4) + '%'})`
  // A known network: its name in the tag, or in the referrer when untagged.
  const pattern = `%${source}%`
  return sql`(${utmSource} ilike ${pattern} or (coalesce(${utmSource}, '') = '' and ${referrer} ilike ${pattern}))`
}

/** Every agreement that belongs to the project, whichever door it came through. */
function projectAgreement(groupId: string): SQL {
  return sql`a.id in (
    select pl.agreement_id from ${schema.projectLeads} pl where pl.group_id = ${groupId} and pl.agreement_id is not null
    union
    select bi.agreement_id from ${schema.bulkBatchItems} bi
      join ${schema.bulkBatches} bb on bb.id = bi.batch_id
      where bb.group_id = ${groupId} and bi.agreement_id is not null
  )`
}

/** The source tags of the registration behind an agreement, when there is one. */
const agreementLeadUtmSource = sql`(select pl.meta->>'utm_source' from ${schema.projectLeads} pl where pl.agreement_id = a.id limit 1)`
const agreementLeadReferrer = sql`(select pl.referrer from ${schema.projectLeads} pl where pl.agreement_id = a.id limit 1)`

const leadUtmSource = sql`${schema.projectLeads.meta}->>'utm_source'`
const leadReferrer = sql`${schema.projectLeads.referrer}`
const eventUtmSource = sql`${schema.campaignEvents.utm}->>'utm_source'`
const eventReferrer = sql`${schema.campaignEvents.referrer}`

async function counts(groupId: string, range: { from?: Date; to?: Date }, source?: string) {
  const db = getDb()
  const [events] = await db
    .select({
      visits: sql<number>`count(distinct ${schema.campaignEvents.visitId}) filter (where ${schema.campaignEvents.type} = 'page_view')`,
      ctaClicks: sql<number>`count(distinct ${schema.campaignEvents.visitId}) filter (where ${schema.campaignEvents.type} = 'join_cta_clicked')`,
      started: sql<number>`count(distinct ${schema.campaignEvents.visitId}) filter (where ${schema.campaignEvents.type} = 'registration_started')`,
      signingStarted: sql<number>`count(distinct ${schema.campaignEvents.visitId}) filter (where ${schema.campaignEvents.type} = 'signing_started')`,
    })
    .from(schema.campaignEvents)
    .where(
      and(
        eq(schema.campaignEvents.groupId, groupId),
        within(sql`${schema.campaignEvents.createdAt}`, range),
        sourceMatch(source, eventUtmSource, eventReferrer),
      ),
    )

  const [leads] = await db
    .select({ registrations: sql<number>`count(*) filter (where ${submittedRegistration()})` })
    .from(schema.projectLeads)
    .where(
      and(
        eq(schema.projectLeads.groupId, groupId),
        within(sql`${schema.projectLeads.createdAt}`, range),
        sourceMatch(source, leadUtmSource, leadReferrer),
      ),
    )

  const [agreements] = await db
    .select({
      agreements: sql<number>`count(*)`,
      signed: sql<number>`count(*) filter (where a.status = 'signed')`,
      pending: sql<number>`count(*) filter (where a.status in ('sent', 'viewed'))`,
    })
    .from(sql`${schema.agreements} a`)
    .where(and(projectAgreement(groupId), within(sql`a.created_at`, range), sourceMatch(source, agreementLeadUtmSource, agreementLeadReferrer)))

  return {
    visits: Number(events?.visits ?? 0),
    ctaClicks: Number(events?.ctaClicks ?? 0),
    started: Number(events?.started ?? 0),
    signingStarted: Number(events?.signingStarted ?? 0),
    registrations: Number(leads?.registrations ?? 0),
    agreements: Number(agreements?.agreements ?? 0),
    signed: Number(agreements?.signed ?? 0),
    pending: Number(agreements?.pending ?? 0),
  }
}

async function timeline(groupId: string, range: { from?: Date; to?: Date }, source?: string): Promise<ProjectReport['timeline']> {
  const db = getDb()
  const spanDays = range.from ? (((range.to ?? new Date()).getTime() - range.from.getTime()) / 86_400_000) : 90
  const granularity: 'day' | 'week' = spanDays <= 45 ? 'day' : 'week'
  const unit = sql.raw(`'${granularity}'`)
  const from = range.from ?? new Date(Date.now() - 90 * 86_400_000)
  const effective = { from, to: range.to }

  const visits = await db
    .select({ bucket: sql<string>`date_trunc(${unit}, ${schema.campaignEvents.createdAt})::date::text`, n: sql<number>`count(distinct ${schema.campaignEvents.visitId})` })
    .from(schema.campaignEvents)
    .where(
      and(
        eq(schema.campaignEvents.groupId, groupId),
        eq(schema.campaignEvents.type, 'page_view'),
        within(sql`${schema.campaignEvents.createdAt}`, effective),
        sourceMatch(source, eventUtmSource, eventReferrer),
      ),
    )
    .groupBy(sql`1`)

  const registrations = await db
    .select({ bucket: sql<string>`date_trunc(${unit}, ${schema.projectLeads.createdAt})::date::text`, n: sql<number>`count(*)` })
    .from(schema.projectLeads)
    .where(
      and(
        eq(schema.projectLeads.groupId, groupId),
        submittedRegistration(),
        within(sql`${schema.projectLeads.createdAt}`, effective),
        sourceMatch(source, leadUtmSource, leadReferrer),
      ),
    )
    .groupBy(sql`1`)

  const signatures = await db
    .select({ bucket: sql<string>`date_trunc(${unit}, a.completed_at)::date::text`, n: sql<number>`count(*)` })
    .from(sql`${schema.agreements} a`)
    .where(
      and(
        projectAgreement(groupId),
        sql`a.status = 'signed'`,
        within(sql`a.completed_at`, effective),
        sourceMatch(source, agreementLeadUtmSource, agreementLeadReferrer),
      ),
    )
    .groupBy(sql`1`)

  const points = new Map<string, { bucket: string; visits: number; registrations: number; signatures: number }>()
  const at = (bucket: string) => {
    let p = points.get(bucket)
    if (!p) points.set(bucket, (p = { bucket, visits: 0, registrations: 0, signatures: 0 }))
    return p
  }
  for (const r of visits) at(r.bucket).visits = Number(r.n)
  for (const r of registrations) at(r.bucket).registrations = Number(r.n)
  for (const r of signatures) at(r.bucket).signatures = Number(r.n)
  // Fill the gaps so the chart draws a continuous line.
  const step = granularity === 'day' ? 86_400_000 : 7 * 86_400_000
  const start = granularity === 'week' ? startOfWeek(from) : new Date(from.toISOString().slice(0, 10))
  const end = range.to ?? new Date()
  for (let t = start.getTime(); t <= end.getTime(); t += step) at(new Date(t).toISOString().slice(0, 10))
  return { granularity, points: [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)) }
}

/** Postgres weeks start on Monday. */
function startOfWeek(date: Date): Date {
  const d = new Date(date.toISOString().slice(0, 10))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d
}

async function statusBreakdown(groupId: string, range: { from?: Date; to?: Date }, source?: string) {
  const db = getDb()
  const [row] = await db
    .select({
      signed: sql<number>`count(*) filter (where a.status = 'signed')`,
      sent: sql<number>`count(*) filter (where a.status = 'sent')`,
      viewed: sql<number>`count(*) filter (where a.status = 'viewed')`,
      expired: sql<number>`count(*) filter (where a.status = 'expired')`,
      canceled: sql<number>`count(*) filter (where a.status in ('canceled', 'declined'))`,
    })
    .from(sql`${schema.agreements} a`)
    .where(and(projectAgreement(groupId), within(sql`a.created_at`, range), sourceMatch(source, agreementLeadUtmSource, agreementLeadReferrer)))
  const [failedRow] = await db
    .select({ failed: sql<number>`count(*)` })
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.groupId, groupId), eq(schema.projectLeads.status, 'failed'), within(sql`${schema.projectLeads.createdAt}`, range), sourceMatch(source, leadUtmSource, leadReferrer)))
  return [
    { key: 'signed', label: 'נחתם', count: Number(row?.signed ?? 0) },
    { key: 'sent', label: 'ממתין', count: Number(row?.sent ?? 0) },
    { key: 'viewed', label: 'נצפה', count: Number(row?.viewed ?? 0) },
    { key: 'expired', label: 'פג תוקף', count: Number(row?.expired ?? 0) },
    { key: 'canceled', label: 'בוטל', count: Number(row?.canceled ?? 0) },
    { key: 'failed', label: 'נכשל', count: Number(failedRow?.failed ?? 0) },
  ].filter((s) => s.count > 0)
}

/** Where visits, registrations and signatures came from, as people name the places. */
async function sources(groupId: string, range: { from?: Date; to?: Date }): Promise<ProjectReport['sources']> {
  const db = getDb()
  const visitRows = await db
    .select({
      source: sql<string | null>`${schema.campaignEvents.utm}->>'utm_source'`.as('s'),
      medium: sql<string | null>`${schema.campaignEvents.utm}->>'utm_medium'`.as('m'),
      referrer: sql<string | null>`${schema.campaignEvents.referrer}`.as('r'),
      n: sql<number>`count(distinct ${schema.campaignEvents.visitId})`,
    })
    .from(schema.campaignEvents)
    .where(and(eq(schema.campaignEvents.groupId, groupId), eq(schema.campaignEvents.type, 'page_view'), within(sql`${schema.campaignEvents.createdAt}`, range)))
    .groupBy(sql`1, 2, 3`)
  const leadRows = await db
    .select({
      source: sql<string | null>`${schema.projectLeads.meta}->>'utm_source'`.as('s'),
      medium: sql<string | null>`${schema.projectLeads.meta}->>'utm_medium'`.as('m'),
      referrer: sql<string | null>`${schema.projectLeads.referrer}`.as('r'),
      registrations: sql<number>`count(*) filter (where ${submittedRegistration()})`,
      signatures: sql<number>`count(*) filter (where a.status = 'signed')`,
    })
    .from(schema.projectLeads)
    .leftJoin(sql`${schema.agreements} a`, sql`a.id = ${schema.projectLeads.agreementId}`)
    .where(and(eq(schema.projectLeads.groupId, groupId), within(sql`${schema.projectLeads.createdAt}`, range)))
    .groupBy(sql`1, 2, 3`)

  const merged = new Map<string, ProjectReport['sources'][number]>()
  const at = (raw: { source: string | null; medium: string | null; referrer: string | null }) => {
    const c = classifySource({ utm_source: raw.source ?? undefined, utm_medium: raw.medium ?? undefined }, raw.referrer)
    const key = c.medium ? `${c.key}|${c.medium}` : c.key
    let s = merged.get(key)
    if (!s) merged.set(key, (s = { key: c.key, label: c.label, medium: c.medium, visits: 0, registrations: 0, signatures: 0, conversion: null }))
    return s
  }
  for (const r of visitRows) at(r).visits += Number(r.n)
  for (const r of leadRows) {
    const s = at(r)
    s.registrations += Number(r.registrations)
    s.signatures += Number(r.signatures)
  }
  return [...merged.values()]
    .map((s) => ({ ...s, conversion: rate(s.signatures, s.visits || s.registrations) }))
    .sort((a, b) => b.registrations - a.registrations || b.visits - a.visits)
}

function rowConditions(groupId: string, filters: ProjectReportFilters): SQL {
  return and(
    eq(schema.projectLeads.groupId, groupId),
    submittedRegistration(),
    within(sql`${schema.projectLeads.createdAt}`, { from: filters.from, to: filters.to }),
    sourceMatch(filters.source, leadUtmSource, leadReferrer),
    filters.status ? STATUS_SETS[filters.status] : sql`true`,
    filters.q
      ? sql`(${schema.projectLeads.data}->>'name' ilike ${'%' + filters.q + '%'} or ${schema.projectLeads.data}->>'businessName' ilike ${'%' + filters.q + '%'} or ${schema.projectLeads.data}->>'contactName' ilike ${'%' + filters.q + '%'} or ${schema.projectLeads.data}->>'taxId' ilike ${'%' + filters.q + '%'} or ${schema.projectLeads.data}->>'phone' ilike ${'%' + filters.q + '%'} or ${schema.projectLeads.data}->>'email' ilike ${'%' + filters.q + '%'})`
      : sql`true`,
  )!
}

async function countRegistrations(groupId: string, filters: ProjectReportFilters): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.projectLeads)
    .leftJoin(sql`${schema.agreements} a`, sql`a.id = ${schema.projectLeads.agreementId}`)
    .where(rowConditions(groupId, filters))
  return Number(row?.n ?? 0)
}

export async function registrationCount(groupId: string, filters: ProjectReportFilters): Promise<number> {
  return countRegistrations(groupId, filters)
}

export async function registrationRows(groupId: string, filters: ProjectReportFilters, limit: number): Promise<RegistrationRow[]> {
  const rows = await getDb()
    .select({
      id: schema.projectLeads.id,
      organizationId: schema.projectLeads.organizationId,
      createdAt: schema.projectLeads.createdAt,
      status: schema.projectLeads.status,
      data: schema.projectLeads.data,
      meta: schema.projectLeads.meta,
      referrer: schema.projectLeads.referrer,
      companyId: schema.projectLeads.companyId,
      invitedBy: schema.projectLeads.invitedBy,
      assigneeUserId: schema.projectLeads.assigneeUserId,
      followUpAt: schema.projectLeads.followUpAt,
      callOutcome: schema.projectLeads.callOutcome,
      internalNote: schema.projectLeads.internalNote,
      agreementId: sql<string | null>`a.id`,
      agreementStatus: sql<string | null>`a.status`,
      sentAt: sql<Date | null>`a.sent_at`,
      completedAt: sql<Date | null>`a.completed_at`,
    })
    .from(schema.projectLeads)
    .leftJoin(sql`${schema.agreements} a`, sql`a.id = ${schema.projectLeads.agreementId}`)
    .where(rowConditions(groupId, filters))
    .orderBy(sql`${schema.projectLeads.createdAt} desc`)
    .limit(limit)

  const tasks = rows.length ? await tasksForLeads(rows[0].organizationId, rows.map((r) => r.id)) : new Map<string, never[]>()

  return rows.map((r) => {
    const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>
    const text = (key: string) => (typeof d[key] === 'string' ? (d[key] as string) : '')
    const { source: traffic, campaign } = leadSource(r.meta, r.referrer)
    // How the person got here, in the worker's words: a personal invitation from
    // a rep, or the campaign page itself (with the traffic source when known).
    const source = r.invitedBy
      ? { key: 'invitation', label: 'הזמנה אישית', medium: null }
      : { key: traffic.key, label: traffic.key === 'direct' ? 'הצטרף באתר' : `הצטרף באתר · ${traffic.label}`, medium: traffic.medium }
    const status = statusOf(r.status, r.agreementStatus)
    const completedAt = r.completedAt ? new Date(r.completedAt) : null
    const createdAt = new Date(r.createdAt)
    return {
      id: r.id,
      createdAt,
      businessName: text('name') || text('businessName'),
      taxId: text('taxId'),
      contactName: text('contactName') || text('signatoryName'),
      phone: text('phone'),
      email: text('email'),
      source,
      campaign,
      registrationStatus: status.key,
      statusLabel: status.label,
      statusTone: status.tone,
      companyId: r.companyId,
      agreement: r.agreementId
        ? { id: r.agreementId, status: r.agreementStatus ?? '', sentAt: r.sentAt ? new Date(r.sentAt) : null, completedAt }
        : null,
      secondsToSign: completedAt ? Math.max(0, Math.round((completedAt.getTime() - createdAt.getTime()) / 1000)) : null,
      // ponytail: one built-in kind today, so the first task is the task.
      task: tasks.get(r.id)?.map(summarizeTask)[0] ?? null,
      linkingNeeded: (r.meta as { linking?: unknown } | null)?.linking === 'needed',
      followUp: { assigneeUserId: r.assigneeUserId ?? null, followUpAt: r.followUpAt ? new Date(r.followUpAt).toISOString() : null, callOutcome: r.callOutcome ?? null, internalNote: r.internalNote ?? null },
    }
  })
}

/** The registrations as a workbook — the same filters as the screen. */
export async function buildProjectWorkbook(session: StaffSession, projectId: string, filters: ProjectReportFilters): Promise<Workbook> {
  const group = await authorizeGroup(session, projectId)
  const rows = await registrationRows(group.id, filters, 20_000)
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet('הרשמות', { views: [{ rightToLeft: true }] })
  sheet.columns = [
    { header: 'תאריך הרשמה', key: 'createdAt', width: 18 },
    { header: 'שם העסק', key: 'businessName', width: 30 },
    { header: 'ח.פ.', key: 'taxId', width: 12 },
    { header: 'איש קשר', key: 'contactName', width: 22 },
    { header: 'טלפון', key: 'phone', width: 14 },
    { header: 'אימייל', key: 'email', width: 28 },
    { header: 'מקור הגעה', key: 'source', width: 16 },
    { header: 'קמפיין', key: 'campaign', width: 18 },
    { header: 'סטטוס', key: 'status', width: 16 },
    { header: 'נשלח', key: 'sentAt', width: 18 },
    { header: 'נחתם', key: 'signedAt', width: 18 },
    { header: 'זמן עד חתימה', key: 'toSign', width: 14 },
  ]
  sheet.getRow(1).font = { bold: true }
  const fmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' })
  for (const r of rows) {
    sheet.addRow({
      createdAt: fmt.format(r.createdAt),
      businessName: r.businessName,
      taxId: r.taxId,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      source: r.source.medium ? `${r.source.label} / ${r.source.medium}` : r.source.label,
      campaign: r.campaign ?? '',
      status: r.statusLabel,
      sentAt: r.agreement?.sentAt ? fmt.format(r.agreement.sentAt) : '',
      signedAt: r.agreement?.completedAt ? fmt.format(r.agreement.completedAt) : '',
      toSign: r.secondsToSign === null ? '' : formatDuration(r.secondsToSign),
    })
  }
  return workbook
}


/** The query-string filters the project report and its export share. */
export function parseProjectReportFilters(params: { from?: string; to?: string; status?: string; source?: string; range?: string; q?: string }): ProjectReportFilters {
  const day = (value: string | undefined, endOfDay: boolean): Date | undefined => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+03:00`)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  let from = day(params.from, false)
  let to = day(params.to, true)
  if (params.range && !from && !to) {
    const days = params.range === 'today' ? 0 : params.range === '7d' ? 7 : params.range === '30d' ? 30 : null
    if (days !== null) {
      const now = new Date()
      from = new Date(now.getTime() - days * 86_400_000)
      from.setHours(0, 0, 0, 0)
      to = undefined
    }
  }
  const status = (['signed', 'pending', 'expired', 'failed', 'attention', 'registered'] as const).find((s) => s === params.status)
  const source = params.source && /^[a-z0-9:._-]{1,80}$/i.test(params.source) ? params.source : undefined
  const q = typeof params.q === 'string' && params.q.trim() ? params.q.trim().slice(0, 80) : undefined
  return { from, to, status, source, q }
}
