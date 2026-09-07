import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { publicBaseUrl } from '@/server/http/public-url'
import { getStorage } from '@/server/storage/blob'
import { skinByKey } from '@/lib/self-service-skins'

/**
 * "תצוגה מקדימה לשיתוף": what a link to the campaign page shows when it
 * is pasted into WhatsApp or a feed — a title, a line, a picture. Kept on
 * the campaign row (landing_config.share); the campaign's page reads it
 * server-side into og:/twitter: tags, so crawlers without JavaScript see it.
 */

export type ShareSettings = {
  title: string
  description: string
  /** Absolute, public, https — what the tags carry. */
  imageUrl: string | null
  /** Where the picture came from: uploaded here, or the campaign's built-in artwork. */
  imageSource: 'upload' | 'default' | 'none'
}

type Stored = { title?: string; description?: string; imageKey?: string | null; imageType?: string | null }

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function stored(landingConfig: unknown): Stored {
  const c = (landingConfig && typeof landingConfig === 'object' ? landingConfig : {}) as { share?: Stored }
  return c.share && typeof c.share === 'object' ? c.share : {}
}

async function ownedGroup(session: StaffSession, groupId: string) {
  const [group] = await getDb()
    .select({ id: schema.groups.id, name: schema.groups.name, landingConfig: schema.groups.landingConfig, organizationId: schema.groups.organizationId })
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.organizationId, session.organizationId), isNull(schema.groups.deletedAt)))
    .limit(1)
  return group ?? null
}

function resolve(group: { id: string; name: string; landingConfig: unknown }): ShareSettings {
  const s = stored(group.landingConfig)
  const skinKey = ((group.landingConfig as { selfService?: { skin?: string } } | null)?.selfService?.skin ?? null) as string | null
  const skin = skinByKey(skinKey)
  const defaults = skin && 'share' in skin ? (skin.share as { title: string; description: string; image: string }) : null
  const base = publicBaseUrl()
  const imageUrl = s.imageKey ? `${base}/api/public/share-image/${group.id}?v=${encodeURIComponent(s.imageKey.slice(-12))}` : defaults ? `${base}${defaults.image}` : null
  return {
    title: s.title?.trim() || defaults?.title || group.name,
    description: s.description?.trim() || defaults?.description || '',
    imageUrl,
    imageSource: s.imageKey ? 'upload' : defaults ? 'default' : 'none',
  }
}

export async function getShareSettings(session: StaffSession, groupId: string): Promise<ShareSettings | null> {
  const group = await ownedGroup(session, groupId)
  return group ? resolve(group) : null
}

export async function saveShareSettings(session: StaffSession, groupId: string, input: { title?: unknown; description?: unknown }): Promise<{ ok: true; settings: ShareSettings } | { ok: false; message: string }> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 90) : undefined
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 200) : undefined
  const previous = (group.landingConfig && typeof group.landingConfig === 'object' ? group.landingConfig : {}) as Record<string, unknown>
  const next: Stored = { ...stored(group.landingConfig), ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) }
  await getDb().update(schema.groups).set({ landingConfig: { ...previous, share: next } }).where(eq(schema.groups.id, group.id))
  return { ok: true, settings: resolve({ ...group, landingConfig: { ...previous, share: next } }) }
}

/** Store a picture for the preview card. PNG/JPEG/WebP, up to 2 MB; 1200×630 recommended. */
export async function saveShareImage(session: StaffSession, groupId: string, file: { bytes: Buffer; type: string }): Promise<{ ok: true; settings: ShareSettings } | { ok: false; message: string }> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const ext = IMAGE_TYPES[file.type]
  if (!ext) return { ok: false, message: 'יש להעלות תמונה בפורמט PNG, JPEG או WebP.' }
  if (file.bytes.length === 0 || file.bytes.length > MAX_IMAGE_BYTES) return { ok: false, message: 'התמונה גדולה מדי (עד 2MB).' }
  const key = `org/${group.organizationId}/groups/${group.id}/share/${randomUUID()}.${ext}`
  await getStorage().put(key, file.bytes, file.type)
  const previous = (group.landingConfig && typeof group.landingConfig === 'object' ? group.landingConfig : {}) as Record<string, unknown>
  const next: Stored = { ...stored(group.landingConfig), imageKey: key, imageType: file.type }
  await getDb().update(schema.groups).set({ landingConfig: { ...previous, share: next } }).where(eq(schema.groups.id, group.id))
  return { ok: true, settings: resolve({ ...group, landingConfig: { ...previous, share: next } }) }
}

export async function removeShareImage(session: StaffSession, groupId: string): Promise<{ ok: true; settings: ShareSettings } | { ok: false; message: string }> {
  const group = await ownedGroup(session, groupId)
  if (!group) return { ok: false, message: 'הקמפיין לא נמצא.' }
  const previous = (group.landingConfig && typeof group.landingConfig === 'object' ? group.landingConfig : {}) as Record<string, unknown>
  const next: Stored = { ...stored(group.landingConfig), imageKey: null, imageType: null }
  await getDb().update(schema.groups).set({ landingConfig: { ...previous, share: next } }).where(eq(schema.groups.id, group.id))
  return { ok: true, settings: resolve({ ...group, landingConfig: { ...previous, share: next } }) }
}

/** The uploaded picture, for the public route: bytes and type, or null. */
export async function shareImageOf(groupId: string): Promise<{ bytes: Buffer; type: string } | null> {
  const [group] = await getDb().select({ landingConfig: schema.groups.landingConfig }).from(schema.groups).where(and(eq(schema.groups.id, groupId), isNull(schema.groups.deletedAt))).limit(1)
  const s = group ? stored(group.landingConfig) : {}
  if (!s.imageKey) return null
  try {
    return { bytes: await getStorage().get(s.imageKey), type: s.imageType ?? 'image/png' }
  } catch {
    return null
  }
}

/** What the campaign page's <head> says about itself, by public address (aliases included). */
export async function shareForSlug(slug: string): Promise<(ShareSettings & { campaignName: string; canonicalUrl: string }) | null> {
  const db = getDb()
  const [row] = await db
    .select({ id: schema.groups.id, name: schema.groups.name, landingConfig: schema.groups.landingConfig, isCurrent: schema.projectPublicSlugs.isCurrent })
    .from(schema.projectPublicSlugs)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.projectPublicSlugs.groupId))
    .where(and(eq(schema.projectPublicSlugs.slug, slug), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!row) return null
  const [current] = row.isCurrent
    ? [{ slug }]
    : await db.select({ slug: schema.projectPublicSlugs.slug }).from(schema.projectPublicSlugs).where(and(eq(schema.projectPublicSlugs.groupId, row.id), eq(schema.projectPublicSlugs.isCurrent, true))).limit(1)
  return { ...resolve(row), campaignName: row.name, canonicalUrl: `${publicBaseUrl()}/${current?.slug ?? slug}` }
}
