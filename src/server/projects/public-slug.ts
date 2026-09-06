import { and, desc, eq } from 'drizzle-orm'
import { validateSlug } from '@/lib/public-slug'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'

/**
 * A project's public address.
 *
 * The address is a marketing choice; the project id and the form id are
 * not. Changing the address adds a row and retires the previous one as an
 * alias, so every address the project ever had keeps working by redirecting
 * straight to the current one — no chain, no loop. A retired slug belongs
 * to its project for good and is never handed to another.
 */

export type PublicSlugSettings = {
  current: string | null
  history: { slug: string; replacedAt: Date | null }[]
}

export type SetSlugResult = { ok: true; slug: string; unchanged: boolean } | { ok: false; message: string }

export async function getPublicSlugSettings(session: StaffSession, groupId: string): Promise<PublicSlugSettings> {
  const group = await authorizeGroup(session, groupId)
  const rows = await getDb()
    .select({ slug: schema.projectPublicSlugs.slug, isCurrent: schema.projectPublicSlugs.isCurrent, replacedAt: schema.projectPublicSlugs.replacedAt })
    .from(schema.projectPublicSlugs)
    .where(eq(schema.projectPublicSlugs.groupId, group.id))
    .orderBy(desc(schema.projectPublicSlugs.replacedAt))
  return {
    current: rows.find((r) => r.isCurrent)?.slug ?? null,
    history: rows.filter((r) => !r.isCurrent).map((r) => ({ slug: r.slug, replacedAt: r.replacedAt })),
  }
}

/**
 * Makes `raw` the project's current address.
 *
 * One of the project's own old addresses may be taken back; any other
 * project's address, current or retired, may not. The previous current
 * address becomes an alias with the time it stepped down.
 */
export async function setPublicSlug(session: StaffSession, groupId: string, raw: string): Promise<SetSlugResult> {
  const group = await authorizeGroup(session, groupId)
  const checked = validateSlug(raw)
  if (!checked.ok) return checked
  const slug = checked.slug
  const db = getDb()

  const [existing] = await db
    .select({ id: schema.projectPublicSlugs.id, groupId: schema.projectPublicSlugs.groupId, isCurrent: schema.projectPublicSlugs.isCurrent })
    .from(schema.projectPublicSlugs)
    .where(eq(schema.projectPublicSlugs.slug, slug))
    .limit(1)

  if (existing && existing.groupId !== group.id) {
    return { ok: false, message: 'הכתובת הזו כבר בשימוש בפרויקט אחר. בחרו כתובת אחרת.' }
  }
  if (existing?.isCurrent) return { ok: true, slug, unchanged: true }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.projectPublicSlugs)
      .set({ isCurrent: false, replacedAt: new Date() })
      .where(and(eq(schema.projectPublicSlugs.groupId, group.id), eq(schema.projectPublicSlugs.isCurrent, true)))
    if (existing) {
      await tx
        .update(schema.projectPublicSlugs)
        .set({ isCurrent: true, replacedAt: null })
        .where(eq(schema.projectPublicSlugs.id, existing.id))
    } else {
      await tx.insert(schema.projectPublicSlugs).values({
        organizationId: group.organizationId,
        groupId: group.id,
        slug,
        isCurrent: true,
      })
    }
  })

  return { ok: true, slug, unchanged: false }
}

/**
 * Gives a project an address if it has none — the campaign's default, or
 * that with a number when another project already took it. Used when
 * self-service is switched on, so a project is never live without an address.
 */
export async function ensurePublicSlug(session: StaffSession, groupId: string, preferred: string): Promise<string> {
  const current = (await getPublicSlugSettings(session, groupId)).current
  if (current) return current
  const base = validateSlug(preferred)
  const stem = base.ok ? base.slug : 'campaign'
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? stem : `${stem}-${n + 1}`
    const result = await setPublicSlug(session, groupId, candidate)
    if (result.ok) return result.slug
  }
  throw new Error('could not find a free public address')
}

export type ResolvedSlug = {
  groupId: string
  organizationId: string
  /** The address to be at. Equal to the requested one unless it is an alias. */
  canonical: string
  isAlias: boolean
}

/** Any address the project ever had → where it lives now. Null for a stranger. */
export async function resolvePublicSlug(slug: string): Promise<ResolvedSlug | null> {
  if (!slug || slug.length > 80) return null
  const db = getDb()
  const [row] = await db
    .select()
    .from(schema.projectPublicSlugs)
    .where(eq(schema.projectPublicSlugs.slug, slug))
    .limit(1)
  if (!row) return null
  if (row.isCurrent) return { groupId: row.groupId, organizationId: row.organizationId, canonical: row.slug, isAlias: false }

  const [current] = await db
    .select({ slug: schema.projectPublicSlugs.slug })
    .from(schema.projectPublicSlugs)
    .where(and(eq(schema.projectPublicSlugs.groupId, row.groupId), eq(schema.projectPublicSlugs.isCurrent, true)))
    .limit(1)
  if (!current) return null
  return { groupId: row.groupId, organizationId: row.organizationId, canonical: current.slug, isAlias: true }
}

/** The project's current address, for links we mint. */
export async function currentSlugOf(groupId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: schema.projectPublicSlugs.slug })
    .from(schema.projectPublicSlugs)
    .where(and(eq(schema.projectPublicSlugs.groupId, groupId), eq(schema.projectPublicSlugs.isCurrent, true)))
    .limit(1)
  return row?.slug ?? null
}
