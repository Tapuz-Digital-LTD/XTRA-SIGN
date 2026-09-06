import { randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { skinByKey, type SkinKey } from '@/lib/self-service-skins'
import type { PlacedField } from '@/lib/fields'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'
import { currentSlugOf, ensurePublicSlug, resolvePublicSlug } from './public-slug'

/**
 * A project's self-service onboarding settings.
 *
 * Self-service is the second way into a project (ADR 0001): a public branded
 * page where a supplier fills in details, reads the agreement, verifies a
 * phone and signs — with no staff step. Everything a person might want to
 * change about it lives here, on the project, and nothing about it is an id
 * in code: which template, who owns the agreements, how long a link lives,
 * what the thank-you page says.
 *
 * Stored inside `groups.landing_config` under `selfService`, beside the
 * regular joining form's settings, so the project's public face is one
 * object. The two doors are exclusive: while self-service is on, the generic
 * joining form does not answer for this project.
 */

export type SelfServiceConfig = {
  enabled: boolean
  /** Which branded page set serves this project. */
  skin: SkinKey | null
  /** The agreement every registrant signs. */
  templateId: string | null
  /** The staff user filed as owner of the agreements the flow creates. */
  ownerUserId: string | null
  /** How long a signing link stays valid. */
  linkTtlDays: number
  thankYouTitle: string
  thankYouText: string
}

export const DEFAULT_SELF_SERVICE: SelfServiceConfig = {
  enabled: false,
  skin: null,
  templateId: null,
  ownerUserId: null,
  linkTtlDays: 30,
  thankYouTitle: 'ההצטרפות הושלמה בהצלחה',
  thankYouText: '',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cleanSelfService(raw: unknown): SelfServiceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ttl = Number(r.linkTtlDays)
  return {
    enabled: r.enabled === true,
    skin: skinByKey(typeof r.skin === 'string' ? r.skin : null)?.key ?? null,
    templateId: typeof r.templateId === 'string' && UUID_RE.test(r.templateId) ? r.templateId : null,
    ownerUserId: typeof r.ownerUserId === 'string' && UUID_RE.test(r.ownerUserId) ? r.ownerUserId : null,
    linkTtlDays: Number.isInteger(ttl) && ttl >= 1 && ttl <= 90 ? ttl : DEFAULT_SELF_SERVICE.linkTtlDays,
    thankYouTitle:
      (typeof r.thankYouTitle === 'string' ? r.thankYouTitle : '').trim().slice(0, 120) ||
      DEFAULT_SELF_SERVICE.thankYouTitle,
    thankYouText: (typeof r.thankYouText === 'string' ? r.thankYouText : '').trim().slice(0, 500),
  }
}

/** The stored object, read leniently — a project made before this existed has nothing here. */
export function selfServiceOf(landingConfig: unknown): SelfServiceConfig {
  const raw = (landingConfig && typeof landingConfig === 'object' ? landingConfig : {}) as Record<string, unknown>
  return cleanSelfService(raw.selfService)
}

export async function getSelfServiceConfig(session: StaffSession, groupId: string): Promise<SelfServiceConfig> {
  const group = await authorizeGroup(session, groupId)
  return selfServiceOf(group.landingConfig)
}

export type SaveSelfServiceResult = { ok: true; config: SelfServiceConfig } | { ok: false; message: string }

/**
 * Saves the settings, and refuses to switch the flow on until it can actually
 * run: a template to sign, an owner to file agreements under, a page to show.
 * Ids are verified inside the caller's organization — a foreign template or
 * user reads as "not found", never as a link across tenants.
 */
export async function saveSelfServiceConfig(
  session: StaffSession,
  groupId: string,
  input: Partial<SelfServiceConfig>,
): Promise<SaveSelfServiceResult> {
  const group = await authorizeGroup(session, groupId)
  const db = getDb()
  const current = selfServiceOf(group.landingConfig)
  const next = cleanSelfService({ ...current, ...input })

  if (next.templateId) {
    const [template] = await db
      .select({ id: schema.templates.id, sourceFileKey: schema.templates.sourceFileKey })
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.id, next.templateId),
          eq(schema.templates.organizationId, session.organizationId),
          isNull(schema.templates.deletedAt),
        ),
      )
      .limit(1)
    if (!template) return { ok: false, message: 'התבנית לא נמצאה.' }
    if (!template.sourceFileKey) return { ok: false, message: 'לתבנית שנבחרה אין קובץ PDF.' }
  }

  if (next.ownerUserId) {
    const [owner] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, next.ownerUserId),
          eq(schema.users.organizationId, session.organizationId),
          isNull(schema.users.disabledAt),
        ),
      )
      .limit(1)
    if (!owner) return { ok: false, message: 'המשתמש שנבחר כבעלים לא נמצא או מושבת.' }
  }

  if (next.enabled) {
    if (!next.skin) return { ok: false, message: 'לפרויקט הזה עדיין לא חובר עמוד קמפיין.' }
    if (!next.templateId) return { ok: false, message: 'יש לבחור את ההסכם לחתימה לפני ההפעלה.' }
    if (!next.ownerUserId) return { ok: false, message: 'יש לבחור בעלים להסכמים לפני ההפעלה.' }

    // One project per page set: two projects answering at /tourism-2026 would
    // be a coin toss for every registrant.
    const [other] = await db
      .select({ id: schema.groups.id, name: schema.groups.name })
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.organizationId, session.organizationId),
          isNull(schema.groups.deletedAt),
          sql`${schema.groups.id} <> ${group.id}`,
          sql`${schema.groups.landingConfig}->'selfService'->>'enabled' = 'true'`,
          sql`${schema.groups.landingConfig}->'selfService'->>'skin' = ${next.skin}`,
        ),
      )
      .limit(1)
    if (other) return { ok: false, message: `עמוד הקמפיין הזה כבר משמש את הפרויקט "${other.name}".` }
  }

  const landingConfig = {
    ...((group.landingConfig && typeof group.landingConfig === 'object' ? group.landingConfig : {}) as Record<string, unknown>),
    selfService: next,
  }
  await db
    .update(schema.groups)
    .set({
      landingConfig,
      // The form id: the stable, publishable identifier the register API is
      // addressed by. Minted once, never changed — the address may change,
      // this may not.
      ...(group.landingSlug ? {} : { landingSlug: randomBytes(8).toString('base64url') }),
    })
    .where(eq(schema.groups.id, group.id))

  // A live project always has an address; the campaign's default unless the
  // project already chose one.
  if (next.enabled && next.skin) await ensurePublicSlug(session, group.id, skinByKey(next.skin)!.defaultSlug)

  return { ok: true, config: next }
}

export type SelfServiceProject = {
  groupId: string
  organizationId: string
  projectName: string
  /** The stable public form id the register API is addressed by. */
  formId: string
  /** The current public address, for the links we mint. */
  publicSlug: string
  notifyEmails: string[]
  config: SelfServiceConfig
  template: { id: string; name: string; sourceFileKey: string; fields: PlacedField[] }
  owner: { id: string; email: string; name: string }
}

/**
 * A project as the public flow sees it, by its stable form id: enabled,
 * alive, and with everything it needs. A project whose template or owner
 * has since disappeared is treated as switched off rather than half-working.
 */
export async function findSelfServiceProjectByFormId(formId: string): Promise<SelfServiceProject | null> {
  if (!formId || formId.length > 64) return null
  const [group] = await getDb()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.landingSlug, formId), isNull(schema.groups.deletedAt)))
    .limit(1)
  return group ? loadSelfServiceProject(group.id) : null
}

/**
 * A project by any public address it ever had. `isAlias` tells the page to
 * send the browser to the canonical address instead of answering here.
 */
export async function findSelfServiceProjectBySlug(
  slug: string,
): Promise<{ project: SelfServiceProject; canonical: string; isAlias: boolean } | null> {
  const resolved = await resolvePublicSlug(slug)
  if (!resolved) return null
  const project = await loadSelfServiceProject(resolved.groupId)
  return project ? { project, canonical: resolved.canonical, isAlias: resolved.isAlias } : null
}

/** The setup script's door: the one project bound to a campaign's pages. */
export async function findSelfServiceProjectBySkin(skin: string): Promise<SelfServiceProject | null> {
  if (!skinByKey(skin)) return null
  const [group] = await getDb()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(
      and(
        isNull(schema.groups.deletedAt),
        sql`${schema.groups.landingConfig}->'selfService'->>'enabled' = 'true'`,
        sql`${schema.groups.landingConfig}->'selfService'->>'skin' = ${skin}`,
      ),
    )
    .orderBy(schema.groups.createdAt)
    .limit(1)
  return group ? loadSelfServiceProject(group.id) : null
}

export async function loadSelfServiceProject(groupId: string): Promise<SelfServiceProject | null> {
  const db = getDb()
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!group?.landingSlug) return null

  const config = selfServiceOf(group.landingConfig)
  if (!config.enabled || !config.templateId || !config.ownerUserId) return null

  const [template] = await db
    .select({
      id: schema.templates.id,
      name: schema.templates.name,
      sourceFileKey: schema.templates.sourceFileKey,
      fields: schema.templates.fields,
    })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, config.templateId),
        eq(schema.templates.organizationId, group.organizationId),
        isNull(schema.templates.deletedAt),
      ),
    )
    .limit(1)
  if (!template?.sourceFileKey) return null

  const [owner] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, config.ownerUserId),
        eq(schema.users.organizationId, group.organizationId),
        isNull(schema.users.disabledAt),
      ),
    )
    .limit(1)
  if (!owner) return null

  const publicSlug = await currentSlugOf(group.id)
  if (!publicSlug) return null

  return {
    groupId: group.id,
    organizationId: group.organizationId,
    projectName: group.name,
    formId: group.landingSlug,
    publicSlug,
    notifyEmails: Array.isArray(group.notifyEmails)
      ? (group.notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string')
      : [],
    config,
    template: {
      id: template.id,
      name: template.name,
      sourceFileKey: template.sourceFileKey,
      fields: Array.isArray(template.fields) ? (template.fields as PlacedField[]) : [],
    },
    owner,
  }
}
