import { and, eq, sql } from 'drizzle-orm'
import { isCampaignEventType, VISIT_ID_RE, type CampaignEventType, type Utm } from '@/lib/campaign-events'
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
