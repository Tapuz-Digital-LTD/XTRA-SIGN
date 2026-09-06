import { eq } from 'drizzle-orm'
import { skinByKey, type SelfServiceSkin } from '@/lib/self-service-skins'
import { getDb, schema } from '@/server/db'

/**
 * Which branded pages an agreement belongs to, if any.
 *
 * Read off the snapshot the onboarding flow froze on the agreement, so the
 * signer page and the post-signing messages can send a self-service signer
 * back to the campaign's own pages instead of the XTRA Sign screens.
 */
export type SelfServiceOrigin = { skin: SelfServiceSkin; projectId: string }

export async function selfServiceOriginOf(agreementId: string): Promise<SelfServiceOrigin | null> {
  const [row] = await getDb()
    .select({ mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)
  return originFromSnapshot(row?.mergeSnapshot)
}

export function originFromSnapshot(snapshot: unknown): SelfServiceOrigin | null {
  const raw = (snapshot as { selfService?: { skin?: unknown; projectId?: unknown } } | null)?.selfService
  if (!raw || typeof raw.projectId !== 'string') return null
  const skin = skinByKey(typeof raw.skin === 'string' ? raw.skin : null)
  return skin ? { skin, projectId: raw.projectId } : null
}
