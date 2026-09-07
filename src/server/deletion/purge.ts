import { and, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { getStorage } from '@/server/storage/blob'
import type { EntityType } from './policy'

/**
 * מחיקה מלאה — the owner's own switch. Everything about the record goes:
 * the rows, their children, the files in storage. No archive, no soft
 * delete, no way back except the backups. Only the organization's owner
 * may call this, and one audit line records what left.
 *
 * Nothing here touches the CRM: a company mirrored from Fireberry loses
 * its local copy only, and the next sync would bring it back.
 */

export type PurgeResult = { ok: true; removed: Record<string, number>; files: number } | { ok: false; message: string }

export async function purgeEntity(session: StaffSession, type: EntityType, id: string): Promise<PurgeResult> {
  if (!session.isOwner) return { ok: false, message: 'מחיקה מלאה שמורה לבעלי הארגון בלבד.' }
  const db = getDb()
  const org = session.organizationId
  const removed: Record<string, number> = {}
  const fileKeys: string[] = []
  const count = (table: string, n: number) => {
    removed[table] = (removed[table] ?? 0) + n
  }
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

  const purgeAgreements = async (tx: Tx, agreementIds: string[]) => {
    if (agreementIds.length === 0) return
    const versions = await tx
      .select({ id: schema.agreementVersions.id, source: schema.agreementVersions.sourceFileKey, rendered: schema.agreementVersions.renderedFileKey, signed: schema.agreementVersions.signedFileKey })
      .from(schema.agreementVersions)
      .where(inArray(schema.agreementVersions.agreementId, agreementIds))
    for (const v of versions) for (const k of [v.source, v.rendered, v.signed]) if (k) fileKeys.push(k)
    const versionIds = versions.map((v) => v.id)
    const recipientIds = (await tx.select({ id: schema.recipients.id }).from(schema.recipients).where(inArray(schema.recipients.agreementId, agreementIds))).map((r) => r.id)

    count('notifications', (await tx.delete(schema.notifications).where(inArray(schema.notifications.agreementId, agreementIds)).returning({ id: schema.notifications.id })).length)
    count('message_sends', (await tx.delete(schema.messageSends).where(inArray(schema.messageSends.agreementId, agreementIds)).returning({ id: schema.messageSends.id })).length)
    if (recipientIds.length) {
      count('deliveries', (await tx.delete(schema.deliveries).where(or(inArray(schema.deliveries.recipientId, recipientIds), inArray(schema.deliveries.agreementId, agreementIds))).returning({ id: schema.deliveries.id })).length)
      count('otp_challenges', (await tx.delete(schema.otpChallenges).where(inArray(schema.otpChallenges.recipientId, recipientIds)).returning({ id: schema.otpChallenges.id })).length)
      count('signing_sessions', (await tx.delete(schema.signingSessions).where(inArray(schema.signingSessions.recipientId, recipientIds)).returning({ id: schema.signingSessions.id })).length)
      count('signing_tokens', (await tx.delete(schema.signingTokens).where(inArray(schema.signingTokens.recipientId, recipientIds)).returning({ id: schema.signingTokens.id })).length)
    }
    if (versionIds.length) {
      count('signatures', (await tx.delete(schema.signatures).where(inArray(schema.signatures.agreementVersionId, versionIds)).returning({ id: schema.signatures.id })).length)
      count('fields', (await tx.delete(schema.fields).where(inArray(schema.fields.agreementVersionId, versionIds)).returning({ id: schema.fields.id })).length)
      count('document_pages', (await tx.delete(schema.documentPages).where(inArray(schema.documentPages.agreementVersionId, versionIds)).returning({ id: schema.documentPages.id })).length)
    }
    count('audit_events', (await tx.delete(schema.auditEvents).where(inArray(schema.auditEvents.agreementId, agreementIds)).returning({ id: schema.auditEvents.id })).length)
    count('recipients', (await tx.delete(schema.recipients).where(inArray(schema.recipients.agreementId, agreementIds)).returning({ id: schema.recipients.id })).length)
    count('bulk_batch_items', (await tx.delete(schema.bulkBatchItems).where(inArray(schema.bulkBatchItems.agreementId, agreementIds)).returning({ agreementId: schema.bulkBatchItems.agreementId })).length)
    await tx.update(schema.projectLeads).set({ agreementId: null }).where(inArray(schema.projectLeads.agreementId, agreementIds))
    count('agreement_versions', (await tx.delete(schema.agreementVersions).where(inArray(schema.agreementVersions.agreementId, agreementIds)).returning({ id: schema.agreementVersions.id })).length)
    count('agreements', (await tx.delete(schema.agreements).where(and(inArray(schema.agreements.id, agreementIds), eq(schema.agreements.organizationId, org))).returning({ id: schema.agreements.id })).length)
  }

  try {
    await db.transaction(async (tx) => {
      switch (type) {
        case 'agreement': {
          const [a] = await tx.select({ id: schema.agreements.id }).from(schema.agreements).where(and(eq(schema.agreements.id, id), eq(schema.agreements.organizationId, org))).limit(1)
          if (!a) throw new Error('not found')
          await purgeAgreements(tx, [a.id])
          break
        }
        case 'company': {
          const [c] = await tx.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.organizationId, org))).limit(1)
          if (!c) throw new Error('not found')
          const agreementIds = (await tx.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.companyId, c.id))).map((r) => r.id)
          await purgeAgreements(tx, agreementIds)
          count('project_leads', (await tx.delete(schema.projectLeads).where(eq(schema.projectLeads.companyId, c.id)).returning({ id: schema.projectLeads.id })).length)
          count('company_groups', (await tx.delete(schema.companyGroups).where(eq(schema.companyGroups.companyId, c.id)).returning({ groupId: schema.companyGroups.groupId })).length)
          count('distribution_recipients', (await tx.delete(schema.distributionRecipients).where(eq(schema.distributionRecipients.companyId, c.id)).returning({ id: schema.distributionRecipients.id })).length)
          count('companies', (await tx.delete(schema.companies).where(eq(schema.companies.id, c.id)).returning({ id: schema.companies.id })).length)
          break
        }
        case 'project': {
          const [g] = await tx.select({ id: schema.groups.id }).from(schema.groups).where(and(eq(schema.groups.id, id), eq(schema.groups.organizationId, org))).limit(1)
          if (!g) throw new Error('not found')
          const viaLeads = (await tx.select({ id: schema.projectLeads.agreementId }).from(schema.projectLeads).where(eq(schema.projectLeads.groupId, g.id))).map((r) => r.id).filter((x): x is string => Boolean(x))
          const batchIds = (await tx.select({ id: schema.bulkBatches.id }).from(schema.bulkBatches).where(eq(schema.bulkBatches.groupId, g.id))).map((b) => b.id)
          const viaBatches = batchIds.length ? (await tx.select({ id: schema.bulkBatchItems.agreementId }).from(schema.bulkBatchItems).where(inArray(schema.bulkBatchItems.batchId, batchIds))).map((r) => r.id).filter((x): x is string => Boolean(x)) : []
          await purgeAgreements(tx, [...new Set([...viaLeads, ...viaBatches])])
          count('campaign_events', (await tx.delete(schema.campaignEvents).where(eq(schema.campaignEvents.groupId, g.id)).returning({ id: schema.campaignEvents.id })).length)
          count('message_sends', (await tx.delete(schema.messageSends).where(eq(schema.messageSends.groupId, g.id)).returning({ id: schema.messageSends.id })).length)
          const distributionIds = (await tx.select({ id: schema.distributions.id }).from(schema.distributions).where(eq(schema.distributions.groupId, g.id))).map((d) => d.id)
          if (distributionIds.length) {
            count('distribution_recipients', (await tx.delete(schema.distributionRecipients).where(inArray(schema.distributionRecipients.distributionId, distributionIds)).returning({ id: schema.distributionRecipients.id })).length)
            count('distributions', (await tx.delete(schema.distributions).where(inArray(schema.distributions.id, distributionIds)).returning({ id: schema.distributions.id })).length)
          }
          if (batchIds.length) {
            count('bulk_batch_items', (await tx.delete(schema.bulkBatchItems).where(inArray(schema.bulkBatchItems.batchId, batchIds)).returning({ batchId: schema.bulkBatchItems.batchId })).length)
            count('bulk_batches', (await tx.delete(schema.bulkBatches).where(inArray(schema.bulkBatches.id, batchIds)).returning({ id: schema.bulkBatches.id })).length)
          }
          count('project_leads', (await tx.delete(schema.projectLeads).where(eq(schema.projectLeads.groupId, g.id)).returning({ id: schema.projectLeads.id })).length)
          count('company_groups', (await tx.delete(schema.companyGroups).where(eq(schema.companyGroups.groupId, g.id)).returning({ groupId: schema.companyGroups.groupId })).length)
          count('project_public_slugs', (await tx.delete(schema.projectPublicSlugs).where(eq(schema.projectPublicSlugs.groupId, g.id)).returning({ id: schema.projectPublicSlugs.id })).length)
          count('notifications', (await tx.delete(schema.notifications).where(and(eq(schema.notifications.organizationId, org), like(schema.notifications.link, `%${g.id}%`))).returning({ id: schema.notifications.id })).length)
          count('groups', (await tx.delete(schema.groups).where(eq(schema.groups.id, g.id)).returning({ id: schema.groups.id })).length)
          break
        }
        case 'template': {
          const [t] = await tx.select({ id: schema.templates.id, key: schema.templates.sourceFileKey }).from(schema.templates).where(and(eq(schema.templates.id, id), eq(schema.templates.organizationId, org))).limit(1)
          if (!t) throw new Error('not found')
          if (t.key) fileKeys.push(t.key)
          await tx.update(schema.groups).set({ defaultTemplateId: null }).where(eq(schema.groups.defaultTemplateId, t.id))
          await tx
            .update(schema.groups)
            .set({ landingConfig: sql`${schema.groups.landingConfig} #- '{selfService,templateId}'` })
            .where(and(eq(schema.groups.organizationId, org), sql`${schema.groups.landingConfig}->'selfService'->>'templateId' = ${t.id}`))
          await tx.update(schema.agreements).set({ templateId: null }).where(eq(schema.agreements.templateId, t.id))
          count('templates', (await tx.delete(schema.templates).where(eq(schema.templates.id, t.id)).returning({ id: schema.templates.id })).length)
          break
        }
        case 'lead': {
          const groupIds = (await tx.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.organizationId, org))).map((g) => g.id)
          count('project_leads', groupIds.length ? (await tx.delete(schema.projectLeads).where(and(eq(schema.projectLeads.id, id), inArray(schema.projectLeads.groupId, groupIds))).returning({ id: schema.projectLeads.id })).length : 0)
          break
        }
        case 'notification': {
          count('notifications', (await tx.delete(schema.notifications).where(and(eq(schema.notifications.id, id), eq(schema.notifications.organizationId, org))).returning({ id: schema.notifications.id })).length)
          break
        }
        default:
          throw new Error('unsupported')
      }
      await tx.insert(schema.adminAuditEvents).values({
        organizationId: org,
        actorEmail: session.email,
        type: 'record_purged',
        metadata: { type, id, removed },
      })
    })
  } catch (error) {
    log.error('purge failed', { type, id, error: String(error) })
    return { ok: false, message: String(error).includes('not found') ? 'הרשומה לא נמצאה.' : 'המחיקה המלאה נכשלה. שום דבר לא נמחק.' }
  }

  // Files go last and best-effort: the rows are gone; a file that lingers is
  // unreachable, and a failure here must not report the deletion as failed.
  let files = 0
  const storage = getStorage()
  for (const key of new Set(fileKeys)) {
    try {
      await storage.delete(key)
      files++
    } catch (error) {
      log.warn('purge: file not removed', { key, error: String(error) })
    }
  }
  return { ok: true, removed, files }
}
