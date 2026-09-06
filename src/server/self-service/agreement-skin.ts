import { eq } from 'drizzle-orm'
import { skinByKey, type SelfServiceSkin } from '@/lib/self-service-skins'
import { getDb, schema } from '@/server/db'
import { currentSlugOf } from '@/server/projects/public-slug'

/**
 * Which campaign an agreement belongs to, if any.
 *
 * Read off the snapshot the onboarding flow froze on the agreement, so the
 * signer page and the post-signing messages can send a self-service signer
 * back to the campaign's own pages instead of the XTRA Sign screens. The
 * address is looked up live, not read from the snapshot: an agreement made
 * under last month's address must land on this month's.
 */
export type SelfServiceOrigin = { skin: SelfServiceSkin; projectId: string }

export async function selfServiceOriginOf(agreementId: string): Promise<(SelfServiceOrigin & { slug: string }) | null> {
  const [row] = await getDb()
    .select({ mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)
  const origin = originFromSnapshot(row?.mergeSnapshot)
  if (!origin) return null
  return { ...origin, slug: (await currentSlugOf(origin.projectId)) ?? origin.skin.defaultSlug }
}

export function originFromSnapshot(snapshot: unknown): SelfServiceOrigin | null {
  const raw = (snapshot as { selfService?: { skin?: unknown; projectId?: unknown } } | null)?.selfService
  if (!raw || typeof raw.projectId !== 'string') return null
  const skin = skinByKey(typeof raw.skin === 'string' ? raw.skin : null)
  return skin ? { skin, projectId: raw.projectId } : null
}
