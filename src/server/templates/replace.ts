import { and, eq, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeTemplateAccess } from '@/server/templates/templates'

/**
 * A new edition of a template takes the old one's place: every campaign
 * that pointed at the old edition (as its default agreement, or as the
 * agreement of its self-service page) now points at the new one, and the
 * old edition leaves the list. Documents already made keep their own copy
 * of the old PDF and its fields — nothing signed or sent changes.
 */
export async function replaceTemplate(session: StaffSession, oldId: string, newId: string): Promise<{ ok: true; rebound: number } | { ok: false; message: string }> {
  if (oldId === newId) return { ok: false, message: 'זו אותה תבנית.' }
  const [oldTemplate, newTemplate] = await Promise.all([authorizeTemplateAccess(session, oldId), authorizeTemplateAccess(session, newId)])
  if (!newTemplate.sourceFileKey) return { ok: false, message: 'לתבנית החדשה אין קובץ.' }
  const db = getDb()
  let rebound = 0
  await db.transaction(async (tx) => {
    const defaults = await tx
      .update(schema.groups)
      .set({ defaultTemplateId: newTemplate.id })
      .where(and(eq(schema.groups.organizationId, session.organizationId), eq(schema.groups.defaultTemplateId, oldTemplate.id), isNull(schema.groups.deletedAt)))
      .returning({ id: schema.groups.id })
    rebound += defaults.length
    const selfService = await tx
      .update(schema.groups)
      .set({ landingConfig: sql`jsonb_set(coalesce(${schema.groups.landingConfig}, '{}'::jsonb), '{selfService,templateId}', to_jsonb(${newTemplate.id}::text), true)` })
      .where(
        and(
          eq(schema.groups.organizationId, session.organizationId),
          isNull(schema.groups.deletedAt),
          sql`${schema.groups.landingConfig}->'selfService'->>'templateId' = ${oldTemplate.id}`,
        ),
      )
      .returning({ id: schema.groups.id })
    rebound += selfService.length
    await tx.update(schema.templates).set({ deletedAt: new Date() }).where(eq(schema.templates.id, oldTemplate.id))
    await tx.insert(schema.adminAuditEvents).values({
      organizationId: session.organizationId,
      actorEmail: session.email,
      type: 'template_replaced',
      metadata: { from: oldTemplate.id, to: newTemplate.id, fromName: oldTemplate.name, toName: newTemplate.name, rebound },
    })
  })
  return { ok: true, rebound }
}
