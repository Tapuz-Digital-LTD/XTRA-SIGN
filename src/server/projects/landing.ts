import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'
import { notify } from '@/server/notifications/notifications'
import { normalizeIsraeliPhone } from '@/lib/phone'

/**
 * A project's public joining form.
 *
 * The slug is random, never derived from the name: the form is meant to be
 * shared with strangers, and it must reveal nothing beyond what the project
 * chose to put on it. A submission creates a lead — never a company; the
 * suppliers list stays a list a person decided on.
 */

export type LandingField = {
  /** 'name' | 'taxId' | 'contactName' | 'phone' | 'email' | 'address' | 'city' | 'custom_*' */
  key: string
  label: string
  required: boolean
}

export type LandingConfig = {
  title: string
  description: string
  successMessage: string
  imageUrl: string | null
  fields: LandingField[]
}

export const DEFAULT_LANDING_FIELDS: LandingField[] = [
  { key: 'name', label: 'שם החברה', required: true },
  { key: 'taxId', label: 'ח.פ / ע.מ', required: false },
  { key: 'contactName', label: 'שם איש הקשר', required: true },
  { key: 'phone', label: 'טלפון', required: true },
  { key: 'email', label: 'אימייל', required: false },
  { key: 'address', label: 'כתובת', required: false },
  { key: 'city', label: 'עיר', required: false },
]

const FIELD_KEY_RE = /^(name|taxId|contactName|phone|email|address|city|custom_[a-z0-9_]{1,30})$/

function cleanConfig(raw: Partial<LandingConfig> | null | undefined, projectName: string): LandingConfig {
  const fields = Array.isArray(raw?.fields)
    ? raw.fields
        .filter(
          (f): f is LandingField =>
            !!f && typeof f.key === 'string' && FIELD_KEY_RE.test(f.key) && typeof f.label === 'string',
        )
        .map((f) => ({ key: f.key, label: f.label.trim().slice(0, 60), required: Boolean(f.required) }))
        .slice(0, 15)
    : DEFAULT_LANDING_FIELDS
  // A form without a company name is a form that cannot become a supplier.
  if (!fields.some((f) => f.key === 'name')) fields.unshift(DEFAULT_LANDING_FIELDS[0])

  return {
    title: (raw?.title ?? '').trim().slice(0, 120) || `הצטרפות לספקי ${projectName}`,
    description: (raw?.description ?? '').trim().slice(0, 1000),
    successMessage:
      (raw?.successMessage ?? '').trim().slice(0, 500) || 'תודה! הפרטים התקבלו, ניצור קשר בהמשך.',
    imageUrl: typeof raw?.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl.trim().slice(0, 500) : null,
    fields,
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
  const raw = group.landingConfig as Partial<LandingConfig> | null
  return {
    enabled: group.landingEnabled,
    slug: group.landingSlug,
    url: landingUrl(group.landingSlug),
    config: cleanConfig(raw, group.name),
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

  // The slug is minted once and kept: a shared link must survive the form
  // being switched off and on again.
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

  return {
    enabled: input.enabled,
    slug,
    url: landingUrl(slug),
    config,
    notifyEmails,
  }
}

export type PublicLanding = {
  groupId: string
  organizationId: string
  projectName: string
  config: LandingConfig
}

/** The form as a stranger sees it. Null unless the form is switched on. */
export async function getPublicLanding(slug: string): Promise<PublicLanding | null> {
  if (!slug || slug.length > 64) return null
  const [group] = await getDb()
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.landingSlug, slug), eq(schema.groups.landingEnabled, true), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!group) return null
  return {
    groupId: group.id,
    organizationId: group.organizationId,
    projectName: group.name,
    config: cleanConfig(group.landingConfig as Partial<LandingConfig> | null, group.name),
  }
}

export type SubmitResult = { ok: true } | { ok: false; message: string; fields?: Record<string, string> }

/** A public submission: validated against the form's own field list, stored as a lead. */
export async function submitLead(input: {
  slug: string
  values: Record<string, unknown>
  ip: string | null
}): Promise<SubmitResult> {
  const landing = await getPublicLanding(input.slug)
  if (!landing) return { ok: false, message: 'הטופס אינו פעיל.' }

  const data: Record<string, string> = {}
  const fieldErrors: Record<string, string> = {}

  for (const field of landing.config.fields) {
    const raw = input.values[field.key]
    const value = typeof raw === 'string' ? raw.trim().slice(0, 300) : ''
    if (!value && field.required) {
      fieldErrors[field.key] = 'שדה חובה'
      continue
    }
    if (!value) continue
    if (field.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      fieldErrors[field.key] = 'כתובת אימייל לא תקינה'
      continue
    }
    if (field.key === 'phone') {
      data[field.key] = normalizeIsraeliPhone(value) ?? value
      continue
    }
    data[field.key] = value
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'חסרים פרטים בטופס.', fields: fieldErrors }
  }
  if (!data.name) return { ok: false, message: 'חסר שם חברה.' }

  await getDb().insert(schema.projectLeads).values({
    organizationId: landing.organizationId,
    groupId: landing.groupId,
    data,
    ip: input.ip,
  })

  const extraEmails = await getDb()
    .select({ notifyEmails: schema.groups.notifyEmails })
    .from(schema.groups)
    .where(eq(schema.groups.id, landing.groupId))
    .limit(1)
    .then((rows) =>
      Array.isArray(rows[0]?.notifyEmails)
        ? (rows[0].notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string')
        : [],
    )

  await notify({
    organizationId: landing.organizationId,
    type: 'new_lead',
    agreementId: null,
    link: `/projects/${landing.groupId}?tab=leads`,
    title: `ספק חדש השאיר פרטים בפרויקט ${landing.projectName}`,
    body: data.name,
    extraEmails,
  })

  return { ok: true }
}
