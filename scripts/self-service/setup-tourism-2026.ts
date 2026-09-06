import { readFileSync } from 'node:fs'
import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '../../src/server/auth/session'
import { getDb, schema } from '../../src/server/db'
import { createGroup } from '../../src/server/groups/groups'
import { publicBaseUrl } from '../../src/server/http/public-url'
import { getSelfServiceConfig, saveSelfServiceConfig } from '../../src/server/projects/self-service'
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
const TEMPLATE_NAME = 'הסכם השתתפות — חודש התיירות הישראלית 2026'
const OWNER_EMAIL = process.env.SELF_SERVICE_OWNER_EMAIL ?? 'tomer@xtra.co.il'
const PDF = '.design/tourism-2026/agreement.pdf'

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
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(and(eq(schema.templates.id, templateId), isNull(schema.templates.deletedAt)))
      .limit(1)
    if (!template) templateId = null
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
  } else {
    const created = await createTemplateFromPdf({ session, buffer: readFileSync(PDF), name: TEMPLATE_NAME })
    if (!created.ok) throw new Error(created.message)
    templateId = created.templateId
    console.log(`template created: ${templateId} (${created.fieldCount} fields from the PDF)`)
  }

  // ── Self-service settings ──────────────────────────────────────────────
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
  console.log(`self-service on: ${publicBaseUrl()}/tourism-2026`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
