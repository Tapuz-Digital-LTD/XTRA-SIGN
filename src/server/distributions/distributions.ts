import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { publicBaseUrl } from '@/server/http/public-url'
import { log } from '@/server/log'
import { brandFor } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { NoticeEmail } from '@/server/mail/templates'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import type { DeliveryResult } from '@/server/notifications/types'
import { renderTemplate, type Variables } from '@/lib/message-template'
import {
  DEFAULT_DISTRIBUTION_MESSAGE,
  MIN_HOURS_BETWEEN_SENDS,
  type DistributionChannel,
  type DistributionContentKind,
  type DistributionDraft,
  type DistributionListItem,
  type DistributionStatus,
} from '@/lib/distributions'

/**
 * Distributions: a message, an audience, a send. Everything a distribution
 * sends goes through the same Inforu providers the rest of the system uses,
 * and every message lands in `message_sends` exactly as it went out.
 *
 * Nothing here touches the CRM: choosing CRM-synced companies as an audience
 * reads the local mirror and writes only to distribution tables.
 */

const MAX_RECIPIENTS = 2000
// ponytail: sends run inside the request with bounded concurrency; a queue
// is the upgrade when a distribution outgrows the function's time budget.
const CONCURRENCY = 5

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string }

async function ownedGroup(session: StaffSession, groupId: string) {
  const [group] = await getDb()
    .select({ id: schema.groups.id, name: schema.groups.name, landingSlug: schema.groups.landingSlug, startsAt: schema.groups.startsAt, endsAt: schema.groups.endsAt })
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.organizationId, session.organizationId), isNull(schema.groups.deletedAt)))
    .limit(1)
  return group ?? null
}

/** The campaign's public address, current slug first, the form id as the fallback. */
export async function campaignUrlFor(groupId: string, landingSlug: string | null): Promise<string | null> {
  const [slug] = await getDb()
    .select({ slug: schema.projectPublicSlugs.slug })
    .from(schema.projectPublicSlugs)
    .where(and(eq(schema.projectPublicSlugs.groupId, groupId), eq(schema.projectPublicSlugs.isCurrent, true)))
    .limit(1)
  const path = slug?.slug ?? landingSlug
  return path ? `${publicBaseUrl()}/${path}` : null
}

function stats(rows: { status: string }[]) {
  return {
    total: rows.length,
    sent: rows.filter((r) => r.status === 'sent').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  }
}

export async function listDistributions(session: StaffSession, groupId: string): Promise<DistributionListItem[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.distributions)
    .where(and(eq(schema.distributions.groupId, groupId), eq(schema.distributions.organizationId, session.organizationId)))
    .orderBy(desc(schema.distributions.createdAt))
  if (rows.length === 0) return []
  const recipients = await db
    .select({ distributionId: schema.distributionRecipients.distributionId, status: schema.distributionRecipients.status })
    .from(schema.distributionRecipients)
    .where(inArray(schema.distributionRecipients.distributionId, rows.map((r) => r.id)))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status as DistributionStatus,
    channels: row.channels as DistributionChannel[],
    contentKind: row.contentKind as DistributionContentKind,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    stats: stats(recipients.filter((r) => r.distributionId === row.id)),
  }))
}

export async function getDistribution(session: StaffSession, id: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(schema.distributions)
    .where(and(eq(schema.distributions.id, id), eq(schema.distributions.organizationId, session.organizationId)))
    .limit(1)
  if (!row) return null
  const recipients = await db
    .select()
    .from(schema.distributionRecipients)
    .where(eq(schema.distributionRecipients.distributionId, id))
    .orderBy(schema.distributionRecipients.name)
  return { ...row, recipients, stats: stats(recipients) }
}

function cleanDraft(raw: unknown): Result<{ draft: DistributionDraft }> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
  if (!name) return { ok: false, message: 'יש להזין שם להפצה.' }
  const channels = Array.isArray(r.channels) ? r.channels.filter((c): c is DistributionChannel => c === 'sms' || c === 'email') : []
  if (channels.length === 0) return { ok: false, message: 'יש לבחור לפחות ערוץ אחד.' }
  const contentKind: DistributionContentKind = r.contentKind === 'url' ? 'url' : 'campaign_link'
  const contentUrl = typeof r.contentUrl === 'string' ? r.contentUrl.trim() : ''
  if (contentKind === 'url' && !/^https?:\/\/\S+$/i.test(contentUrl)) return { ok: false, message: 'יש להזין כתובת תקינה (https://…).' }
  const m = (r.message && typeof r.message === 'object' ? r.message : {}) as { sms?: unknown; email?: { subject?: unknown; body?: unknown; cta?: unknown } }
  const message = {
    sms: typeof m.sms === 'string' && m.sms.trim() ? m.sms.trim().slice(0, 1000) : DEFAULT_DISTRIBUTION_MESSAGE.sms,
    email: {
      subject: typeof m.email?.subject === 'string' && m.email.subject.trim() ? m.email.subject.trim().slice(0, 200) : DEFAULT_DISTRIBUTION_MESSAGE.email.subject,
      body: typeof m.email?.body === 'string' && m.email.body.trim() ? m.email.body.trim().slice(0, 5000) : DEFAULT_DISTRIBUTION_MESSAGE.email.body,
      cta: typeof m.email?.cta === 'string' && m.email.cta.trim() ? m.email.cta.trim().slice(0, 60) : DEFAULT_DISTRIBUTION_MESSAGE.email.cta,
    },
  }
  // A message that never places the link is a message nobody can act on.
  const linkVar = '{{campaign_url}}'
  if (channels.includes('sms') && !message.sms.includes(linkVar)) return { ok: false, message: 'הודעת ה-SMS חייבת לכלול את המשתנה {{campaign_url}}.' }
  if (channels.includes('email') && !message.email.body.includes(linkVar) && !message.email.cta) return { ok: false, message: 'הודעת האימייל חייבת לכלול קישור.' }
  const a = (r.audience && typeof r.audience === 'object' ? r.audience : {}) as { kind?: unknown; source?: unknown; companyIds?: unknown }
  const companyIds = Array.isArray(a.companyIds) ? [...new Set(a.companyIds.filter((x): x is string => typeof x === 'string'))] : []
  if (companyIds.length === 0) return { ok: false, message: 'יש לבחור לפחות נמען אחד.' }
  if (companyIds.length > MAX_RECIPIENTS) return { ok: false, message: `אפשר לשלוח עד ${MAX_RECIPIENTS} נמענים בהפצה אחת.` }
  const scheduledAt = typeof r.scheduledAt === 'string' && r.scheduledAt ? r.scheduledAt : null
  if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) return { ok: false, message: 'מועד התזמון אינו תקין.' }
  return {
    ok: true,
    draft: {
      name,
      channels,
      contentKind,
      contentUrl,
      message,
      audience: { kind: a.kind === 'customer' ? 'customer' : 'supplier', source: a.source === 'crm' || a.source === 'xtra' ? a.source : 'all', companyIds },
      scheduledAt,
    },
  }
}

/**
 * Save a distribution with its recipients resolved from the chosen companies.
 * Recipients without a usable address for any chosen channel are kept as
 * `skipped` so the count on screen is honest.
 */
export async function createDistribution(session: StaffSession, groupId: string, raw: unknown): Promise<Result<{ id: string; stats: ReturnType<typeof stats> }>> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const cleaned = cleanDraft(raw)
  if (!cleaned.ok) return cleaned
  const { draft } = cleaned
  if (draft.contentKind === 'campaign_link' && !(await campaignUrlFor(group.id, group.landingSlug))) {
    return { ok: false, message: 'לקמפיין אין עדיין עמוד ציבורי. הפעילו את עמוד הקמפיין בהגדרות או בחרו "כתובת אחרת".' }
  }
  const db = getDb()
  const companies = await db
    .select({ id: schema.companies.id, name: schema.companies.name, contactName: schema.companies.contactName, phone: schema.companies.contactPhone, email: schema.companies.contactEmail })
    .from(schema.companies)
    .where(and(eq(schema.companies.organizationId, session.organizationId), inArray(schema.companies.id, draft.audience.companyIds), isNull(schema.companies.deletedAt)))
  if (companies.length === 0) return { ok: false, message: 'לא נמצאו נמענים.' }

  const [row] = await db
    .insert(schema.distributions)
    .values({
      organizationId: session.organizationId,
      groupId: group.id,
      name: draft.name,
      status: 'draft',
      channels: draft.channels,
      contentKind: draft.contentKind,
      contentUrl: draft.contentKind === 'url' ? draft.contentUrl : null,
      message: draft.message,
      audience: { kind: draft.audience.kind, source: draft.audience.source, count: companies.length },
      scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt) : null,
      createdBy: session.userId,
    })
    .returning({ id: schema.distributions.id })
  const recipients = companies.map((c) => {
    const reachable = (draft.channels.includes('sms') && c.phone) || (draft.channels.includes('email') && c.email)
    return {
      distributionId: row.id,
      companyId: c.id,
      name: c.contactName?.trim() || c.name,
      phone: c.phone,
      email: c.email,
      status: reachable ? 'pending' : 'skipped',
      error: reachable ? null : 'אין טלפון או אימייל לערוצים שנבחרו',
    }
  })
  await db.insert(schema.distributionRecipients).values(recipients)
  return { ok: true, id: row.id, stats: stats(recipients) }
}

/** Who this distribution's audience got something from us in the last day. */
async function recentlyContacted(organizationId: string, recipients: { phone: string | null; email: string | null }[]) {
  const since = new Date(Date.now() - MIN_HOURS_BETWEEN_SENDS * 3600 * 1000)
  const phones = recipients.map((r) => r.phone).filter((p): p is string => Boolean(p))
  const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))
  if (phones.length === 0 && emails.length === 0) return new Set<string>()
  const rows = await getDb()
    .select({ phone: schema.distributionRecipients.phone, email: schema.distributionRecipients.email })
    .from(schema.distributionRecipients)
    .innerJoin(schema.distributions, eq(schema.distributions.id, schema.distributionRecipients.distributionId))
    .where(
      and(
        eq(schema.distributions.organizationId, organizationId),
        eq(schema.distributionRecipients.status, 'sent'),
        gt(schema.distributionRecipients.sentAt, since),
        or(phones.length ? inArray(schema.distributionRecipients.phone, phones) : sql`false`, emails.length ? inArray(schema.distributionRecipients.email, emails) : sql`false`),
      ),
    )
  const hit = new Set<string>()
  for (const r of rows) {
    if (r.phone) hit.add(`p:${r.phone}`)
    if (r.email) hit.add(`e:${r.email}`)
  }
  return hit
}

type Rendered = { sms?: string; email?: { subject: string; text: string; html: string } }

async function renderFor(input: {
  organizationId: string
  channels: DistributionChannel[]
  message: DistributionDraft['message']
  vars: Variables
  url: string
}): Promise<Rendered> {
  const out: Rendered = {}
  if (input.channels.includes('sms')) out.sms = renderTemplate(input.message.sms, input.vars).text
  if (input.channels.includes('email')) {
    const subject = renderTemplate(input.message.email.subject, input.vars).text
    const body = renderTemplate(input.message.email.body, input.vars).text
    const rendered = await renderEmail(
      subject,
      NoticeEmail({ brand: await brandFor({ organizationId: input.organizationId }), title: subject, body, ctaLabel: input.message.email.cta || 'למעבר', ctaUrl: input.url }),
    )
    out.email = rendered
  }
  return out
}

/**
 * Send it. Every recipient is attempted once per channel; a recipient
 * reached in the last day is skipped unless an admin overrides — and the
 * override is written to the audit trail. Test sends go to one address only,
 * never to the audience, and are flagged as tests wherever they are stored.
 */
export async function sendDistribution(
  session: StaffSession,
  id: string,
  options: { override?: boolean; test?: { phone?: string; email?: string } } = {},
): Promise<Result<{ stats: ReturnType<typeof stats>; skippedRecent: number }>> {
  const db = getDb()
  const dist = await getDistribution(session, id)
  if (!dist) return { ok: false, message: 'ההפצה לא נמצאה.' }
  const group = await ownedGroup(session, dist.groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const channels = dist.channels as DistributionChannel[]
  const message = (dist.message ?? DEFAULT_DISTRIBUTION_MESSAGE) as DistributionDraft['message']
  const url = dist.contentKind === 'url' ? dist.contentUrl! : await campaignUrlFor(group.id, group.landingSlug)
  if (!url) return { ok: false, message: 'לקמפיין אין עמוד ציבורי לשלוח אליו.' }

  const sms = new InforuSmsProvider()
  const email = new InforuEmailProvider()
  const baseVars: Variables = {
    campaign_name: group.name,
    campaign_url: url,
    distribution_name: dist.name,
    campaign_start: group.startsAt ? group.startsAt.toLocaleDateString('he-IL') : '',
    campaign_end: group.endsAt ? group.endsAt.toLocaleDateString('he-IL') : '',
  }

  const record = async (input: { channel: DistributionChannel; recipient: string; subject: string | null; body: string; vars: Variables; result: DeliveryResult; isTest: boolean }) => {
    await db.insert(schema.messageSends).values({
      organizationId: session.organizationId,
      groupId: group.id,
      distributionId: dist.id,
      channel: input.channel,
      event: input.isTest ? 'test' : 'distribution',
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      variables: input.vars,
      providerMessageId: input.result.providerMessageId,
      isTest: input.isTest,
      ok: input.result.ok,
      error: input.result.ok ? null : input.result.error,
    })
  }

  // ── Test send: one person, the sender's own details, nothing else moves. ──
  if (options.test) {
    const vars = { ...baseVars, signer_name: session.name || 'בדיקה', contact_name: session.name || 'בדיקה', company_name: 'בדיקה' }
    const rendered = await renderFor({ organizationId: session.organizationId, channels, message, vars, url })
    const results: Record<string, DeliveryResult> = {}
    if (rendered.sms && options.test.phone) {
      results.sms = await sms.send({ to: options.test.phone, text: `[בדיקה] ${rendered.sms}` })
      await record({ channel: 'sms', recipient: options.test.phone, subject: null, body: rendered.sms, vars, result: results.sms, isTest: true })
    }
    if (rendered.email && options.test.email) {
      results.email = await email.send({ to: options.test.email, subject: `[בדיקה] ${rendered.email.subject}`, text: rendered.email.text, html: rendered.email.html })
      await record({ channel: 'email', recipient: options.test.email, subject: rendered.email.subject, body: rendered.email.text, vars, result: results.email, isTest: true })
    }
    const failed = Object.values(results).filter((r) => !r.ok)
    if (Object.keys(results).length === 0) return { ok: false, message: 'יש להזין טלפון או אימייל לבדיקה.' }
    if (failed.length) return { ok: false, message: `שליחת הבדיקה נכשלה: ${failed.map((f) => (f.ok ? '' : f.error)).join(', ')}` }
    return { ok: true, stats: dist.stats, skippedRecent: 0 }
  }

  if (dist.status === 'sent' || dist.status === 'sending') return { ok: false, message: 'ההפצה כבר נשלחה.' }
  if (options.override && !session.isAdmin) return { ok: false, message: 'רק מנהל יכול לעקוף את מגבלת 24 השעות.' }

  const pending = dist.recipients.filter((r) => r.status === 'pending')
  const recent = await recentlyContacted(session.organizationId, pending)
  const isRecent = (r: { phone: string | null; email: string | null }) => (r.phone && recent.has(`p:${r.phone}`)) || (r.email && recent.has(`e:${r.email}`))
  const skippedRecent = options.override ? 0 : pending.filter(isRecent).length

  await db.update(schema.distributions).set({ status: 'sending' }).where(eq(schema.distributions.id, dist.id))
  if (options.override && skippedRecent === 0 && pending.some(isRecent)) {
    await db.insert(schema.adminAuditEvents).values({
      organizationId: session.organizationId,
      actorEmail: session.email,
      type: 'distribution_cadence_override',
      metadata: { distributionId: dist.id, name: dist.name, recipients: pending.filter(isRecent).length },
    })
  }

  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const r = pending[cursor++]
      if (!options.override && isRecent(r)) {
        await db
          .update(schema.distributionRecipients)
          .set({ status: 'skipped', error: `נשלחה הודעה ב-${MIN_HOURS_BETWEEN_SENDS} השעות האחרונות` })
          .where(eq(schema.distributionRecipients.id, r.id))
        continue
      }
      const vars: Variables = { ...baseVars, signer_name: r.name, contact_name: r.name, first_name: r.name.split(' ')[0] ?? r.name, company_name: r.name, phone: r.phone ?? '', email: r.email ?? '' }
      const results: Record<string, { ok: boolean; id: string | null; error?: string }> = {}
      try {
        const rendered = await renderFor({ organizationId: session.organizationId, channels, message, vars, url })
        if (rendered.sms && r.phone) {
          const res = await sms.send({ to: r.phone, text: rendered.sms, recipientName: r.name })
          results.sms = { ok: res.ok, id: res.providerMessageId, error: res.ok ? undefined : res.error }
          await record({ channel: 'sms', recipient: r.phone, subject: null, body: rendered.sms, vars, result: res, isTest: false })
        }
        if (rendered.email && r.email) {
          const res = await email.send({ to: r.email, subject: rendered.email.subject, text: rendered.email.text, html: rendered.email.html, recipientName: r.name })
          results.email = { ok: res.ok, id: res.providerMessageId, error: res.ok ? undefined : res.error }
          await record({ channel: 'email', recipient: r.email, subject: rendered.email.subject, body: rendered.email.text, vars, result: res, isTest: false })
        }
      } catch (error) {
        log.error('distribution send failed', { distributionId: dist.id, recipientId: r.id, error: String(error) })
        results.error = { ok: false, id: null, error: String(error) }
      }
      const anyOk = Object.values(results).some((x) => x.ok)
      const errors = Object.values(results).filter((x) => !x.ok).map((x) => x.error).filter(Boolean)
      await db
        .update(schema.distributionRecipients)
        .set({ status: anyOk ? 'sent' : 'failed', results, error: errors.length ? errors.join('; ') : null, sentAt: anyOk ? new Date() : null })
        .where(eq(schema.distributionRecipients.id, r.id))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))

  const after = await db
    .select({ status: schema.distributionRecipients.status })
    .from(schema.distributionRecipients)
    .where(eq(schema.distributionRecipients.distributionId, dist.id))
  const finalStats = stats(after)
  const status: DistributionStatus = finalStats.sent > 0 ? 'sent' : finalStats.total === finalStats.skipped ? 'sent' : 'failed'
  await db.update(schema.distributions).set({ status, sentAt: new Date(), stats: finalStats }).where(eq(schema.distributions.id, dist.id))
  return { ok: true, stats: finalStats, skippedRecent }
}

export async function deleteDraftDistribution(session: StaffSession, id: string): Promise<Result> {
  const db = getDb()
  const [row] = await db
    .select({ id: schema.distributions.id, status: schema.distributions.status })
    .from(schema.distributions)
    .where(and(eq(schema.distributions.id, id), eq(schema.distributions.organizationId, session.organizationId)))
    .limit(1)
  if (!row) return { ok: false, message: 'ההפצה לא נמצאה.' }
  if (row.status !== 'draft') return { ok: false, message: 'אפשר למחוק רק טיוטה. הפצה שנשלחה נשארת בהיסטוריה.' }
  await db.delete(schema.distributions).where(eq(schema.distributions.id, id))
  return { ok: true }
}
