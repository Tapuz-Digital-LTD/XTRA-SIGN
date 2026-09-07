import { and, desc, eq, gt, inArray, lt, or } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { consume } from '@/server/http/rate-limit'
import { log } from '@/server/log'

/**
 * The one door every person-addressed message goes through.
 *
 * In order, and all before a provider is called:
 *   1. permission — the person belongs to the caller's organisation;
 *   2. eligibility — the message makes sense for where the person is
 *      (no reminders to someone who signed) and the channel has an address;
 *   3. suppression — someone who asked not to be contacted is not, unless an
 *      admin explicitly sends an operational message anyway (audited);
 *   4. rate limit — per staff member;
 *   5. cooldown — the same message on the same channel to the same person
 *      waits 24 hours, unless an admin overrides (audited);
 *   6. reservation — the row is written first, under a lock on the person,
 *      with the caller's attempt key: the same key never sends twice, and
 *      two clicks at once cannot both pass the cooldown.
 * Only then the provider is called, and the row records what it said.
 *
 * WhatsApp has no provider: the reservation is the record that the share
 * opened; the rep's confirmation later turns it into a send or not.
 */

export const COOLDOWN_HOURS = 24
const RESERVED = 'reserved'
const ABANDONED = 'abandoned'
/** How long a reservation may sit without an outcome before another attempt may take the slot. */
export const RESERVATION_TTL_MS = 2 * 60_000

export type DispatchEvent = 'invitation' | 'reminder'
export type DispatchChannel = 'sms' | 'email' | 'whatsapp'

export type DispatchLead = { id: string; organizationId: string; groupId: string; agreementId: string | null; status: string; phone: string | null; email: string | null }

export type RenderedMessage = { to: string; subject: string | null; body: string; html?: string; variables?: Record<string, unknown> }
export type ProviderResult = { ok: boolean; providerMessageId: string | null; error?: string }

export type DispatchInput = {
  session: StaffSession
  lead: DispatchLead
  /** Where the person is, as the caller sees it (signed people are never messaged). */
  processStatus: 'invited' | 'registered' | 'awaiting_signature' | 'signed' | 'failed'
  channel: DispatchChannel
  event: DispatchEvent
  /** One key per attempt from the client; a retry with the same key returns the same row. */
  attemptKey?: string | null
  /** An admin's explicit decision to send despite a cooldown or a suppression. Audited. */
  force?: boolean
  render: () => Promise<RenderedMessage>
  /** Absent for WhatsApp. */
  send?: (message: RenderedMessage) => Promise<ProviderResult>
}

export type DispatchState = 'sent' | 'opened' | 'duplicate' | 'failed' | 'not_eligible' | 'suppressed' | 'cooldown' | 'rate_limited' | 'forbidden'

export type DispatchResult =
  | { ok: true; state: 'sent' | 'opened' | 'duplicate'; sendId: string; to: string; body: string }
  | { ok: false; state: Exclude<DispatchState, 'sent' | 'opened' | 'duplicate'>; message: string; sendId?: string; retryAfter?: number }

const CHANNEL_WORD: Record<DispatchChannel, string> = { sms: 'SMS', email: 'אימייל', whatsapp: 'WhatsApp' }

/** Normalised address for the suppression list and the cooldown. */
export function addressFor(lead: Pick<DispatchLead, 'phone' | 'email'>, channel: DispatchChannel): string | null {
  return channel === 'email' ? (lead.email?.toLowerCase() ?? null) : (lead.phone ?? null)
}

export async function isSuppressed(organizationId: string, channel: DispatchChannel, address: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.contactSuppressions.id })
    .from(schema.contactSuppressions)
    .where(and(eq(schema.contactSuppressions.organizationId, organizationId), inArray(schema.contactSuppressions.channel, [channel === 'whatsapp' ? 'sms' : channel, 'any']), eq(schema.contactSuppressions.address, address)))
    .limit(1)
  return rows.length > 0
}

export async function suppressContact(session: StaffSession, input: { channel: 'sms' | 'email' | 'any'; address: string; reason?: string | null }): Promise<void> {
  await getDb()
    .insert(schema.contactSuppressions)
    .values({ organizationId: session.organizationId, channel: input.channel, address: input.channel === 'email' ? input.address.toLowerCase() : input.address, reason: input.reason ?? null, createdBy: session.userId })
    .onConflictDoNothing()
}

async function overrideAudit(session: StaffSession, lead: DispatchLead, channel: DispatchChannel, event: DispatchEvent, reason: 'cooldown' | 'suppressed') {
  await getDb().insert(schema.adminAuditEvents).values({ organizationId: session.organizationId, actorEmail: session.email, type: 'send_override', metadata: { leadId: lead.id, channel, event, reason } })
}

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const { session, lead, channel, event } = input
  const db = getDb()

  // 1. permission
  if (lead.organizationId !== session.organizationId) return { ok: false, state: 'forbidden', message: 'אין הרשאה.' }

  // 2. eligibility
  if (input.processStatus === 'signed') return { ok: false, state: 'not_eligible', message: 'כבר חתם — אין מה לשלוח.' }
  if (input.processStatus === 'failed') return { ok: false, state: 'not_eligible', message: 'התהליך נכשל או בוטל.' }
  if (event === 'reminder' && !lead.agreementId) return { ok: false, state: 'not_eligible', message: 'עדיין אין הסכם לתזכורת.' }
  const address = addressFor(lead, channel)
  if (!address) return { ok: false, state: 'not_eligible', message: channel === 'email' ? 'אין אימייל.' : 'אין טלפון.' }

  // 3. suppression
  if (await isSuppressed(session.organizationId, channel, address)) {
    if (!input.force || !session.isAdmin) return { ok: false, state: 'suppressed', message: 'האדם ביקש לא לקבל הודעות. מנהל יכול לשלוח הודעה תפעולית במפורש.' }
    await overrideAudit(session, lead, channel, event, 'suppressed')
  }

  // 4. rate limit
  const gate = await consume('signingLink', `${session.userId}:dispatch`)
  if (!gate.allowed) return { ok: false, state: 'rate_limited', message: 'נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות.', retryAfter: gate.retryAfter }

  const rendered = await input.render()
  const attemptKey = input.attemptKey && /^[A-Za-z0-9:_-]{8,120}$/.test(input.attemptKey) ? input.attemptKey : null

  // 5 + 6. cooldown and reservation — lock-free, so it holds on any
  // connection: the attempt key is unique per organisation, and a partial
  // unique index allows one reservation in flight per person, channel and
  // message. Two clicks at once both pass the cooldown check; only one
  // insert succeeds, and the other reads back what won.
  const findByAttempt = async () =>
    attemptKey
      ? (
          await db
            .select({ id: schema.messageSends.id, ok: schema.messageSends.ok, error: schema.messageSends.error, manualState: schema.messageSends.manualState, recipient: schema.messageSends.recipient, body: schema.messageSends.body })
            .from(schema.messageSends)
            .where(and(eq(schema.messageSends.organizationId, session.organizationId), eq(schema.messageSends.attemptKey, attemptKey)))
            .limit(1)
        )[0]
      : undefined
  const replay = (d: NonNullable<Awaited<ReturnType<typeof findByAttempt>>>): DispatchResult => {
    const state: DispatchState = d.error === RESERVED ? 'duplicate' : channel === 'whatsapp' ? 'opened' : d.ok ? 'sent' : 'failed'
    if (state === 'failed') return { ok: false, state, message: humanize(d.error), sendId: d.id }
    return { ok: true, state: state === 'sent' || state === 'opened' ? state : 'duplicate', sendId: d.id, to: d.recipient, body: d.body }
  }
  const existing = await findByAttempt()
  if (existing) return replay(existing)

  // A reservation nobody finished (a crash between the row and the provider)
  // is given up after a couple of minutes: marked abandoned, so it stops
  // holding the slot and shows up as a failure to retry, never as a send.
  await db
    .update(schema.messageSends)
    .set({ error: ABANDONED })
    .where(and(eq(schema.messageSends.leadId, lead.id), eq(schema.messageSends.channel, channel), eq(schema.messageSends.event, event), eq(schema.messageSends.error, RESERVED), lt(schema.messageSends.sentAt, new Date(Date.now() - RESERVATION_TTL_MS))))

  const since = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000)
  const [recent] = await db
    .select({ id: schema.messageSends.id, sentAt: schema.messageSends.sentAt, error: schema.messageSends.error })
    .from(schema.messageSends)
    .where(
      and(
        eq(schema.messageSends.leadId, lead.id),
        eq(schema.messageSends.channel, channel),
        eq(schema.messageSends.event, event),
        eq(schema.messageSends.isTest, false),
        gt(schema.messageSends.sentAt, since),
        channel === 'whatsapp' ? eq(schema.messageSends.manualState, 'sent') : or(eq(schema.messageSends.ok, true), eq(schema.messageSends.error, RESERVED)),
      ),
    )
    .orderBy(desc(schema.messageSends.sentAt))
    .limit(1)
  if (recent) {
    if (recent.error === RESERVED) return { ok: false, state: 'cooldown', message: 'השליחה כבר מתבצעת.', sendId: recent.id }
    if (!input.force || !session.isAdmin) {
      const hours = Math.max(1, Math.ceil((recent.sentAt.getTime() + COOLDOWN_HOURS * 3600_000 - Date.now()) / 3600_000))
      return { ok: false, state: 'cooldown', message: `נשלחה כבר הודעה כזו ב-${CHANNEL_WORD[channel]} ב-${COOLDOWN_HOURS} השעות האחרונות. אפשר שוב בעוד כ-${hours} שעות; מנהל יכול לשלוח בכל זאת.`, sendId: recent.id, retryAfter: hours * 3600 }
    }
    await overrideAudit(session, lead, channel, event, 'cooldown')
  }

  const [row] = await db
    .insert(schema.messageSends)
    .values({
      organizationId: session.organizationId,
      groupId: lead.groupId,
      agreementId: lead.agreementId,
      leadId: lead.id,
      sentBy: session.userId,
      channel,
      event,
      recipient: rendered.to,
      subject: rendered.subject,
      body: rendered.body,
      variables: rendered.variables ?? null,
      attemptKey,
      ok: false,
      error: channel === 'whatsapp' ? null : RESERVED,
      manualState: channel === 'whatsapp' ? 'opened' : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.messageSends.id })
  if (!row) {
    // Lost the race: the same attempt landed first, or another reservation is in flight.
    const winner = await findByAttempt()
    if (winner) return replay(winner)
    return { ok: false, state: 'cooldown', message: 'השליחה כבר מתבצעת.' }
  }
  const sendId = row.id

  const touch = () => db.update(schema.projectLeads).set({ lastActivityAt: new Date() }).where(eq(schema.projectLeads.id, lead.id)).catch(() => undefined)

  if (channel === 'whatsapp' || !input.send) {
    await touch()
    return { ok: true, state: 'opened', sendId, to: rendered.to, body: rendered.body }
  }

  let result: ProviderResult
  try {
    result = await input.send(rendered)
  } catch (error) {
    result = { ok: false, providerMessageId: null, error: error instanceof Error ? error.message : String(error) }
  }
  await db
    .update(schema.messageSends)
    .set({ ok: result.ok, providerMessageId: result.providerMessageId, error: result.ok ? null : (result.error ?? 'השליחה נכשלה') })
    .where(eq(schema.messageSends.id, sendId))
  await touch()
  if (!result.ok) {
    log.warn('dispatch: provider refused', { leadId: lead.id, channel, event, error: result.error })
    return { ok: false, state: 'failed', message: humanize(result.error), sendId }
  }
  return { ok: true, state: 'sent', sendId, to: rendered.to, body: rendered.body }
}

export function humanize(error: string | null | undefined): string {
  if (!error || error === RESERVED || error === ABANDONED) return 'השליחה לא הושלמה. נסו שוב בעוד רגע.'
  if (/mailing list|invalid|not valid|address/i.test(error)) return 'הכתובת לא התקבלה אצל ספק ההודעות. בדקו את הפרטים ונסו שוב.'
  if (/credentials|missing|SIGN_LOG_NOTIFICATIONS/i.test(error)) return 'שירות ההודעות אינו מוגדר בסביבה הזו, ההודעה נרשמה בלבד.'
  return 'השליחה נכשלה. נסו שוב בעוד רגע.'
}
