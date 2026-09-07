import { readFileSync } from 'node:fs'
import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '../../src/server/auth/session'
import { getDb, schema } from '../../src/server/db'
import { createGroup, updateCampaign } from '../../src/server/groups/groups'
import { saveProjectNotificationSettings } from '../../src/server/projects/notification-settings'
import { ensurePublicSlug } from '../../src/server/projects/public-slug'
import { publicBaseUrl } from '../../src/server/http/public-url'
import { findSelfServiceProjectBySkin, getSelfServiceConfig, saveSelfServiceConfig } from '../../src/server/projects/self-service'
import { createTemplateFromPdf } from '../../src/server/templates/templates'

/**
 * Sets an environment up for the Ministry of Tourism campaign, through the
 * same services the settings screen uses — nothing here that a person could
 * not do in Project Settings, just done without the clicks. Idempotent: run
 * it again and it converges without touching what exists.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/self-service/setup-tourism-2026.ts
 *   npx dotenv-cli -e .env.preview -- npx tsx scripts/self-service/setup-tourism-2026.ts
 *
 * What it ensures: the owner (tomer@xtra.co.il, else the first admin), the
 * project "חודש התיירות הישראלית 2026" (found by exact name — an older
 * "שבוע התיירות 2026" is left alone), the agreement template from the
 * Ministry PDF, and the self-service settings switched on.
 */

const PROJECT_NAME = 'חודש התיירות הישראלית 2026'
const TEMPLATE_NAME = 'הסכם השתתפות (דיגיטלי) — חודש התיירות הישראלית 2026'
const OWNER_EMAIL = process.env.SELF_SERVICE_OWNER_EMAIL ?? 'tomer@xtra.co.il'
/**
 * The digital-route copy of the Ministry's agreement: the original with its
 * "save and email it" footer line removed and nothing else touched
 * (scripts/design/prepare-agreement.ts, verified by verify-agreement.ts).
 * The original stays in .design/ untouched, for traceability.
 */
const PDF = '.design/tourism-2026/agreement-digital.pdf'
/** The public address; the skin key and the slug are the same word on purpose. */
const PUBLIC_SLUG = process.env.PUBLIC_SLUG ?? 'tourism-2026'
/** Who hears about registrations and signatures. Comma-separated; unset = leave as is. */
const NOTIFY_EMAILS = process.env.NOTIFY_EMAILS?.split(',').map((e) => e.trim()).filter(Boolean)

async function main() {
  const db = getDb()

  const [org] = await db.select().from(schema.organizations).limit(1)
  if (!org) throw new Error('no organization — bootstrap the app first')

  const users = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.organizationId, org.id), isNull(schema.users.disabledAt)))
  const owner = users.find((u) => u.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) ?? users.find((u) => u.isAdmin)
  if (!owner) throw new Error(`no owner: ${OWNER_EMAIL} not found and no admin user exists`)
  const session: StaffSession = {
    userId: owner.id,
    organizationId: org.id,
    email: owner.email,
    name: owner.name,
    isAdmin: true,
  }
  console.log(`owner: ${owner.email}${owner.email.toLowerCase() === OWNER_EMAIL.toLowerCase() ? '' : ' (fallback admin)'}`)

  // ── Project ────────────────────────────────────────────────────────────
  const [existingProject] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.organizationId, org.id), eq(schema.groups.name, PROJECT_NAME), isNull(schema.groups.deletedAt)))
    .limit(1)
  let groupId = existingProject?.id
  if (groupId) {
    console.log(`project exists: ${groupId}`)
  } else {
    const created = await createGroup({
      session,
      name: PROJECT_NAME,
      description: 'קמפיין משרד התיירות — הרשמה וחתימה עצמאית מעמוד הקול הקורא. XTRA Sign בלבד, ללא Fireberry.',
      kind: 'supplier',
      campaignKind: 'public',
    })
    if (!created.ok) throw new Error(created.message)
    groupId = created.id
    console.log(`project created: ${groupId}`)
  }

  // ── Template ───────────────────────────────────────────────────────────
  const current = await getSelfServiceConfig(session, groupId)
  let templateId = current.templateId
  if (templateId) {
    const [template] = await db
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(and(eq(schema.templates.id, templateId), isNull(schema.templates.deletedAt)))
      .limit(1)
    // A configured template under another name is an earlier edition of the
    // agreement; the current edition replaces it on the project (the old
    // template stays, and documents made from it keep their copy).
    // With SKIP_TEMPLATE=1 whatever the app has bound (uploaded by hand) is the agreement.
    if (!template || (template.name !== TEMPLATE_NAME && process.env.SKIP_TEMPLATE !== '1')) templateId = null
  }
  if (!templateId) {
    const [byName] = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(and(eq(schema.templates.organizationId, org.id), eq(schema.templates.name, TEMPLATE_NAME), isNull(schema.templates.deletedAt)))
      .limit(1)
    templateId = byName?.id ?? null
  }
  if (templateId) {
    console.log(`template exists: ${templateId}`)
  } else if (process.env.SKIP_TEMPLATE === '1') {
    // Storage is not reachable from here (a Vercel OIDC token scoped to
    // development cannot write the production store); the PDF goes in
    // through the deployed app instead, and a later run picks it up by name.
    console.log('template: skipped (SKIP_TEMPLATE=1) — upload it through the app, then run again')
  } else {
    const created = await createTemplateFromPdf({ session, buffer: readFileSync(PDF), name: TEMPLATE_NAME })
    if (!created.ok) throw new Error(created.message)
    templateId = created.templateId
    console.log(`template created: ${templateId} (${created.fieldCount} fields from the PDF)`)
  }

  // ── Self-service settings (only once there is an agreement to sign) ────
  if (templateId) {
    const saved = await saveSelfServiceConfig(session, groupId, {
      enabled: true,
      skin: 'tourism-2026',
      templateId,
      ownerUserId: owner.id,
      linkTtlDays: current.linkTtlDays,
      thankYouTitle: current.thankYouTitle,
      thankYouText: current.thankYouText,
    })
    if (!saved.ok) throw new Error(saved.message)
  }

  // ── Campaign kind, owner, agreement ────────────────────────────────────
  const campaign = await updateCampaign(session, groupId, { campaignKind: 'public', ownerUserId: owner.id, defaultTemplateId: templateId ?? undefined })
  if (!campaign.ok) throw new Error(campaign.message)

  // ── Public address ─────────────────────────────────────────────────────
  const slug = await ensurePublicSlug(session, groupId, PUBLIC_SLUG)
  if (slug !== PUBLIC_SLUG) console.warn(`public slug is "${slug}", not "${PUBLIC_SLUG}" — already taken?`)

  // ── Who gets told ──────────────────────────────────────────────────────
  if (NOTIFY_EMAILS?.length) {
    const notified = await saveProjectNotificationSettings(session, groupId, { emails: NOTIFY_EMAILS, events: { new_registration: true, signed: true, send_failed: true, unsigned_digest: true, expiring_digest: true } })
    if (!notified.ok) throw new Error(notified.message)
    console.log(`notifications → ${notified.settings.emails.join(', ')}`)
  }
  console.log(`public page: ${publicBaseUrl()}/${slug}`)
  console.log(`self-service on: ${publicBaseUrl()}/${(await findSelfServiceProjectBySkin('tourism-2026'))?.publicSlug}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
