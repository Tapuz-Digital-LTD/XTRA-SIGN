import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '../../src/server/auth/session'
import { getDb, schema } from '../../src/server/db'
import { updateCampaign } from '../../src/server/groups/groups'
import { getSelfServiceConfig, saveSelfServiceConfig } from '../../src/server/projects/self-service'

/**
 * Points a campaign at one template — the campaign's default agreement and
 * the self-service one — through the same services the settings screen
 * uses. For the moment an upload happened outside the setup script.
 *
 *   PROJECT_NAME='…' TEMPLATE_ID=<uuid> [RETIRE_TEMPLATE_ID=<uuid>] npx dotenv-cli -e <env> -- npx tsx scripts/ops/bind-template.ts
 */
const PROJECT_NAME = process.env.PROJECT_NAME ?? 'חודש התיירות הישראלית 2026'
const TEMPLATE_ID = process.env.TEMPLATE_ID ?? ''
const RETIRE = process.env.RETIRE_TEMPLATE_ID ?? ''
if (!TEMPLATE_ID) throw new Error('TEMPLATE_ID required')

async function main() {
  const db = getDb()
  const [org] = await db.select().from(schema.organizations).limit(1)
  if (!org) throw new Error('no organization')
  const [owner] = await db.select().from(schema.users).where(and(eq(schema.users.organizationId, org.id), eq(schema.users.isAdmin, true), isNull(schema.users.disabledAt))).limit(1)
  if (!owner) throw new Error('no admin')
  const session: StaffSession = { userId: owner.id, organizationId: org.id, email: owner.email, name: owner.name, isAdmin: true }
  const [project] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.organizationId, org.id), eq(schema.groups.name, PROJECT_NAME), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!project) throw new Error('project not found')
  const [template] = await db.select({ id: schema.templates.id, name: schema.templates.name }).from(schema.templates).where(and(eq(schema.templates.id, TEMPLATE_ID), eq(schema.templates.organizationId, org.id), isNull(schema.templates.deletedAt))).limit(1)
  if (!template) throw new Error('template not found')

  const current = await getSelfServiceConfig(session, project.id)
  const saved = await saveSelfServiceConfig(session, project.id, { ...current, enabled: true, templateId: template.id })
  if (!saved.ok) throw new Error(saved.message)
  const campaign = await updateCampaign(session, project.id, { defaultTemplateId: template.id })
  if (!campaign.ok) throw new Error(campaign.message)
  console.log(`bound "${template.name}" (${template.id}) to ${PROJECT_NAME}`)
  if (RETIRE && RETIRE !== template.id) {
    await db.update(schema.templates).set({ deletedAt: new Date() }).where(and(eq(schema.templates.id, RETIRE), eq(schema.templates.organizationId, org.id)))
    console.log(`retired ${RETIRE}`)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
