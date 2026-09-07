import { and, asc, eq, sql } from 'drizzle-orm'
import { classifySource, isCampaignEventType, VISIT_ID_RE, type CampaignEventType, type TrafficSource, type Utm } from '@/lib/campaign-events'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'

/**
 * Writes one campaign event. Never throws to the caller: analytics must not
 * be able to break a page or a registration, so a failed insert is logged
 * and swallowed.
 */
export type CampaignEventInput = {
  organizationId: string
  groupId: string
  type: CampaignEventType
  visitId: string
  requestedSlug?: string | null
  canonicalSlug?: string | null
  path?: string | null
  utm?: Utm | null
  /** Host only; the caller strips the rest. */
  referrer?: string | null
  registrationId?: string | null
  agreementId?: string | null
  /** The personal invitation whose link brought this visit. */
  invitationId?: string | null
}

export async function recordCampaignEvent(input: CampaignEventInput): Promise<void> {
  if (!isCampaignEventType(input.type) || !VISIT_ID_RE.test(input.visitId)) return
  try {
    await getDb()
      .insert(schema.campaignEvents)
      .values({
        organizationId: input.organizationId,
        groupId: input.groupId,
        type: input.type,
        visitId: input.visitId,
        requestedSlug: input.requestedSlug?.slice(0, 80) ?? null,
        canonicalSlug: input.canonicalSlug?.slice(0, 80) ?? null,
        path: input.path?.slice(0, 200) ?? null,
        utm: input.utm && Object.keys(input.utm).length > 0 ? input.utm : null,
        referrer: input.referrer?.slice(0, 120) ?? null,
        registrationId: input.registrationId ?? null,
        agreementId: input.agreementId ?? null,
        invitationId: input.invitationId ?? null,
      })
  } catch (error) {
    log.warn('campaign event not recorded', { type: input.type, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Once a visit turned into a registration, its earlier events learn which
 * one — so a signature can be traced back to the page view that started it.
 */
export async function linkVisitToRegistration(groupId: string, visitId: string, registrationId: string, agreementId: string | null) {
  if (!VISIT_ID_RE.test(visitId)) return
  try {
    await getDb()
      .update(schema.campaignEvents)
      .set({ registrationId, ...(agreementId ? { agreementId } : {}) })
      .where(
        and(
          eq(schema.campaignEvents.groupId, groupId),
          eq(schema.campaignEvents.visitId, visitId),
          sql`${schema.campaignEvents.registrationId} is null`,
        ),
      )
  } catch (error) {
    log.warn('campaign visit not linked', { error: error instanceof Error ? error.message : String(error) })
  }
}

export type Touch = { at: string; source: TrafficSource | 'invitation'; invitationId: string | null; utm: Utm | null; referrer: string | null }
export type Attribution = { first: Touch | null; last: Touch | null }

/**
 * Where this visit came from — the first identified touch and the last one
 * before the registration. A direct return visit never erases an earlier
 * identified source; with nothing identified at all, both stay null and
 * the reports say "לא ידוע" rather than guessing.
 */
export async function attributionFor(groupId: string, visitId: string | null | undefined, fallback?: { invitationId?: string | null; utm?: Utm | null }): Promise<Attribution> {
  const touches: Touch[] = []
  if (visitId && VISIT_ID_RE.test(visitId)) {
    try {
      const rows = await getDb()
        .select({ at: schema.campaignEvents.createdAt, utm: schema.campaignEvents.utm, referrer: schema.campaignEvents.referrer, invitationId: schema.campaignEvents.invitationId })
        .from(schema.campaignEvents)
        .where(and(eq(schema.campaignEvents.groupId, groupId), eq(schema.campaignEvents.visitId, visitId)))
        .orderBy(asc(schema.campaignEvents.createdAt))
        .limit(200)
      for (const row of rows) {
        const utm = (row.utm as Utm | null) ?? null
        const identified = Boolean(row.invitationId) || Boolean(utm && Object.keys(utm).length) || Boolean(row.referrer)
        if (!identified) continue
        touches.push({ at: row.at.toISOString(), source: row.invitationId ? 'invitation' : classifySource(utm, row.referrer), invitationId: row.invitationId, utm, referrer: row.referrer })
      }
    } catch (error) {
      log.warn('attribution not read', { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (touches.length === 0 && fallback && (fallback.invitationId || (fallback.utm && Object.keys(fallback.utm).length))) {
    touches.push({ at: new Date().toISOString(), source: fallback.invitationId ? 'invitation' : classifySource(fallback.utm ?? null, null), invitationId: fallback.invitationId ?? null, utm: fallback.utm ?? null, referrer: null })
  }
  return { first: touches[0] ?? null, last: touches[touches.length - 1] ?? null }
}
