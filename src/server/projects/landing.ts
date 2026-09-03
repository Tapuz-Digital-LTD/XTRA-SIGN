import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'
import { log } from '@/server/log'
import { notify } from '@/server/notifications/notifications'
import {
  normalizeFields,
  validateSubmission,
  type FormField,
} from './form-schema'

/**
 * A project's public joining form.
 *
 * The slug is random, never derived from the name: the form is meant to be
 * shared with strangers, and it must reveal nothing beyond what the project
 * chose to put on it. It doubles as the form's public id for the embed and
 * the submission API — publishable, and scoped to exactly one power: creating
 * a lead. A submission creates a lead — never a company; the suppliers list
 * stays a list a person decided on.
 */

export type LandingConfig = {
  title: string
  description: string
  successMessage: string
  imageUrl: string | null
  fields: FormField[]
  /**
   * Origins allowed to submit cross-site (the API and the embed). Empty means
   * any origin — the form is public by nature; the list exists for projects
   * that want to pin it down.
   */
  allowedOrigins: string[]
}

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i

function cleanConfig(raw: Partial<LandingConfig> | null | undefined, projectName: string): LandingConfig {
  return {
    title: (raw?.title ?? '').trim().slice(0, 120) || `הצטרפות לספקי ${projectName}`,
    description: (raw?.description ?? '').trim().slice(0, 1000),
    successMessage:
      (raw?.successMessage ?? '').trim().slice(0, 500) || 'תודה! הפרטים התקבלו, ניצור קשר בהמשך.',
    imageUrl: typeof raw?.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl.trim().slice(0, 500) : null,
    fields: normalizeFields(raw?.fields),
    allowedOrigins: (Array.isArray(raw?.allowedOrigins) ? raw.allowedOrigins : [])
      .map((o) => (typeof o === 'string' ? o.trim().replace(/\/+$/, '') : ''))
      .filter((o) => ORIGIN_RE.test(o))
      .slice(0, 20),
  }
}

export type LandingSettings = {
  enabled: boolean
  slug: string | null
  url: string | null
  config: LandingConfig
  notifyEmails: string[]
}

function landingUrl(slug: string | null): string | null {
  if (!slug) return null
  const base = (process.env.SIGN_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/join/${slug}`
}

export async function getLandingSettings(session: StaffSession, groupId: string): Promise<LandingSettings> {
  const group = await authorizeGroup(session, groupId)
  return {
    enabled: group.landingEnabled,
    slug: group.landingSlug,
    url: landingUrl(group.landingSlug),
    config: cleanConfig(group.landingConfig as Partial<LandingConfig> | null, group.name),
    notifyEmails: Array.isArray(group.notifyEmails)
      ? (group.notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string')
      : [],
  }
}

export async function saveLandingSettings(
  session: StaffSession,
  groupId: string,
  input: { enabled: boolean; config: Partial<LandingConfig>; notifyEmails?: string[] },
): Promise<LandingSettings> {
  const group = await authorizeGroup(session, groupId)
  const db = getDb()

  // The slug is minted once and kept: a shared link, an embed on someone's
  // site and an API integration must all survive the form being edited.
  const slug = group.landingSlug ?? randomBytes(8).toString('base64url')
  const config = cleanConfig(input.config, group.name)
  const notifyEmails = (input.notifyEmails ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 20)

  await db
    .update(schema.groups)
    .set({
      landingEnabled: input.enabled,
      landingSlug: slug,
      landingConfig: config,
      notifyEmails,
    })
    .where(eq(schema.groups.id, group.id))

  return { enabled: input.enabled, slug, url: landingUrl(slug), config, notifyEmails }
}

export type PublicLanding = {
  groupId: string
  organizationId: string
  projectName: string
  config: LandingConfig
}

/** The form as a stranger sees it: published, and without its hidden fields. */
export async function getPublicLanding(slug: string): Promise<PublicLanding | null> {
  if (!slug || slug.length > 64) return null
  const [group] = await getDb()
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.landingSlug, slug), eq(schema.groups.landingEnabled, true), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!group) return null
  const config = cleanConfig(group.landingConfig as Partial<LandingConfig> | null, group.name)
  return {
    groupId: group.id,
    organizationId: group.organizationId,
    projectName: group.name,
    config: { ...config, fields: config.fields.filter((f) => !f.hidden) },
  }
}

export type SubmitResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; message: string; fields?: Record<string, string> }

export type SubmissionSource = 'landing' | 'embed' | 'api'

/**
 * THE submission pipeline. The hosted page, the embed and the public API all
 * end here: validate against the published schema, normalise, dedupe, store
 * the lead with a snapshot of the form it answered, notify.
 */
export async function submitLead(input: {
  slug: string
  values: Record<string, unknown>
  ip: string | null
  source: SubmissionSource
  referrer?: string | null
  idempotencyKey?: string | null
}): Promise<SubmitResult> {
  const landing = await getPublicLanding(input.slug)
  if (!landing) return { ok: false, message: 'הטופס אינו פעיל.' }

  const result = validateSubmission(landing.config.fields, input.values ?? {})
  if (!result.ok) return { ok: false, message: 'חסרים פרטים בטופס.', fields: result.fields }
  if (!result.data.name) return { ok: false, message: 'חסר שם חברה.' }

  const db = getDb()

  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? createHash('sha256').update(`${landing.groupId}:${input.idempotencyKey.trim().slice(0, 200)}`).digest('hex')
      : null

  // Without a caller key: the same exact answers arriving twice within a day —
  // a double-tap, a retry, a refresh — are one lead, not two.
  if (!idempotencyKey) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [existing] = await db
      .select({ id: schema.projectLeads.id })
      .from(schema.projectLeads)
      .where(
        and(
          eq(schema.projectLeads.groupId, landing.groupId),
          gt(schema.projectLeads.createdAt, dayAgo),
          sql`${schema.projectLeads.data} = ${JSON.stringify(result.data)}::jsonb`,
        ),
      )
      .limit(1)
    if (existing) return { ok: true, duplicate: true }
  }

  const referrer =
    typeof input.referrer === 'string' && /^https?:\/\//i.test(input.referrer)
      ? input.referrer.slice(0, 300)
      : null

  try {
    const inserted = await db
      .insert(schema.projectLeads)
      .values({
        organizationId: landing.organizationId,
        groupId: landing.groupId,
        data: result.data,
        formSnapshot: landing.config.fields,
        source: input.source,
        referrer,
        idempotencyKey,
        ip: input.ip,
      })
      .onConflictDoNothing()
      .returning({ id: schema.projectLeads.id })
    // A replayed idempotency key is a success that already happened.
    if (inserted.length === 0) return { ok: true, duplicate: true }
  } catch (error) {
    log.error('lead insert failed', { error: String(error) })
    return { ok: false, message: 'השליחה נכשלה. נסו שוב בעוד רגע.' }
  }

  const extraEmails = await db
    .select({ notifyEmails: schema.groups.notifyEmails })
    .from(schema.groups)
    .where(eq(schema.groups.id, landing.groupId))
    .limit(1)
    .then((rows) =>
      Array.isArray(rows[0]?.notifyEmails)
        ? (rows[0].notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string')
        : [],
    )

  // Extension point: outbound webhooks (lead.created, and later lead.approved /
  // agreement.signed) belong exactly here — after the lead is real, beside the
  // notification, fired best-effort so a slow endpoint can never fail a
  // submission. Not built until a project needs one.
  await notify({
    organizationId: landing.organizationId,
    type: 'new_lead',
    agreementId: null,
    link: `/projects/${landing.groupId}?tab=leads`,
    title: `ספק חדש השאיר פרטים בפרויקט ${landing.projectName}`,
    body: result.data.name,
    extraEmails,
  })

  return { ok: true }
}
