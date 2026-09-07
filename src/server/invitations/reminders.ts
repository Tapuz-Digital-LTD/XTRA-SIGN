import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { resendAgreement } from '@/server/documents/send-agreement'
import { authorizeGroup } from '@/server/groups/groups'
import { nameOf, processStatus, sendInvitation } from './invitations'

/**
 * "שלח תזכורת לנבחרים": who can get one right now, and why not.
 *
 * Eligible: waiting for a signature (the reminder carries the signing link)
 * or invited and not yet registered (the invitation goes out again) — with
 * a phone or an email, and nothing sent to them in the last day. Everyone
 * else is listed with the reason, so the person sees the exact count before
 * confirming. Signed people are never reminded.
 */

const MIN_HOURS_BETWEEN = 24

export type ReminderPlanRow = { id: string; name: string; channel: 'sms' | 'email'; kind: 'reminder' | 'invitation' }
export type ReminderPlan = { eligible: ReminderPlanRow[]; skipped: { id: string; name: string; why: string }[] }

export async function planReminders(session: StaffSession, groupId: string, ids: string[]): Promise<ReminderPlan> {
  const group = await authorizeGroup(session, groupId)
  const db = getDb()
  const clean = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 500)
  if (clean.length === 0) return { eligible: [], skipped: [] }
  const rows = await db
    .select({ lead: schema.projectLeads, agreementStatus: schema.agreements.status })
    .from(schema.projectLeads)
    .leftJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .where(and(eq(schema.projectLeads.groupId, group.id), inArray(schema.projectLeads.id, clean)))
  const since = new Date(Date.now() - MIN_HOURS_BETWEEN * 60 * 60 * 1000)
  const agreementIds = rows.map((r) => r.lead.agreementId).filter((x): x is string => Boolean(x))
  const recent = await db
    .select({ leadId: schema.messageSends.leadId, agreementId: schema.messageSends.agreementId })
    .from(schema.messageSends)
    .where(
      and(
        eq(schema.messageSends.organizationId, session.organizationId),
        eq(schema.messageSends.isTest, false),
        eq(schema.messageSends.ok, true),
        gt(schema.messageSends.sentAt, since),
        or(inArray(schema.messageSends.leadId, clean), agreementIds.length ? inArray(schema.messageSends.agreementId, agreementIds) : sql`false`),
      ),
    )
  const contactedLeads = new Set(recent.map((r) => r.leadId).filter(Boolean))
  const contactedAgreements = new Set(recent.map((r) => r.agreementId).filter(Boolean))

  const plan: ReminderPlan = { eligible: [], skipped: [] }
  for (const { lead, agreementStatus } of rows) {
    const name = nameOf(lead.data) || '—'
    const status = processStatus(lead.status, agreementStatus)
    const channel: 'sms' | 'email' | null = lead.phone ? 'sms' : lead.email ? 'email' : null
    if (status === 'signed') plan.skipped.push({ id: lead.id, name, why: 'כבר חתם' })
    else if (status === 'failed') plan.skipped.push({ id: lead.id, name, why: 'התהליך נכשל או בוטל' })
    else if (!channel) plan.skipped.push({ id: lead.id, name, why: 'אין טלפון או אימייל' })
    else if (contactedLeads.has(lead.id) || (lead.agreementId && contactedAgreements.has(lead.agreementId))) plan.skipped.push({ id: lead.id, name, why: `נשלחה הודעה ב-${MIN_HOURS_BETWEEN} השעות האחרונות` })
    else if (status === 'awaiting_signature' && lead.agreementId) plan.eligible.push({ id: lead.id, name, channel, kind: 'reminder' })
    else if (status === 'invited') plan.eligible.push({ id: lead.id, name, channel, kind: 'invitation' })
    else plan.skipped.push({ id: lead.id, name, why: 'נרשם ועדיין אין הסכם לתזכורת' })
  }
  return plan
}

export type ReminderRunResult = { sent: number; failed: { id: string; name: string; message: string }[]; skipped: number }

export async function runReminders(session: StaffSession, groupId: string, ids: string[]): Promise<ReminderRunResult> {
  const plan = await planReminders(session, groupId, ids)
  const db = getDb()
  const result: ReminderRunResult = { sent: 0, failed: [], skipped: plan.skipped.length }
  for (const row of plan.eligible) {
    try {
      if (row.kind === 'invitation') {
        const sent = await sendInvitation(session, row.id, row.channel)
        if (sent.ok) result.sent++
        else result.failed.push({ id: row.id, name: row.name, message: sent.message })
        continue
      }
      const [lead] = await db.select({ agreementId: schema.projectLeads.agreementId }).from(schema.projectLeads).where(eq(schema.projectLeads.id, row.id)).limit(1)
      if (!lead?.agreementId) continue
      const sent = await resendAgreement({ session, agreementId: lead.agreementId, channels: [row.channel], kind: 'reminder' })
      if (!sent.ok) {
        result.failed.push({ id: row.id, name: row.name, message: sent.message ?? 'השליחה נכשלה.' })
        continue
      }
      // The ordinary send records by agreement; the tracked person gets the rows too.
      await db.update(schema.messageSends).set({ leadId: row.id, sentBy: session.userId }).where(and(eq(schema.messageSends.agreementId, lead.agreementId), sql`${schema.messageSends.leadId} is null`))
      await db.update(schema.projectLeads).set({ lastActivityAt: new Date() }).where(eq(schema.projectLeads.id, row.id))
      const [latest] = await db.select({ ok: schema.messageSends.ok, error: schema.messageSends.error }).from(schema.messageSends).where(eq(schema.messageSends.agreementId, lead.agreementId)).orderBy(desc(schema.messageSends.sentAt)).limit(1)
      if (latest && !latest.ok) result.failed.push({ id: row.id, name: row.name, message: latest.error ?? 'השליחה נכשלה.' })
      else result.sent++
    } catch (error) {
      result.failed.push({ id: row.id, name: row.name, message: error instanceof Error ? error.message : 'השליחה נכשלה.' })
    }
  }
  return result
}
