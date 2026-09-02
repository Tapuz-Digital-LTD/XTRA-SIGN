import { and, eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { saveRecipient } from '@/server/documents/save-fields'
import { sendAgreement } from '@/server/documents/send-agreement'
import { log } from '@/server/log'
import { authorizeGroup, listGroupCompanies } from '@/server/groups/groups'
import { createDocumentFromTemplate } from '@/server/templates/templates'
import { authorizeTemplateAccess } from '@/server/templates/templates'

/**
 * Sending one template to every company in a group.
 *
 * Each company gets its own agreement, filed to it, running the ordinary
 * lifecycle — this is a loop over the normal send, not a new kind of document
 * with a list of recipients. Anything else would mean one signature standing
 * for eighty companies.
 *
 * Idempotency is the point of the batch table. `(batch, company)` is a primary
 * key, and a row only reaches 'sent' once the send actually returned; a retry
 * skips those and reruns the rest, so pressing the button twice cannot send a
 * supplier two copies.
 *
 * Work happens in chunks with no transaction spanning the sends: SMS and email
 * are third-party calls that can hang, and holding a database transaction open
 * across them would be a very good way to take the database down with them.
 */

const CHUNK = 10

export type BulkPlanRow = {
  companyId: string
  companyName: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  ready: boolean
  reason: string | null
}

export type BulkPlan = {
  templateName: string
  rows: BulkPlanRow[]
  readyCount: number
}

export type BulkResult = {
  batchId: string
  sent: number
  failed: { companyName: string; reason: string }[]
  skipped: number
}

/** What a send would do, before anything is created. */
export async function planBulkSend(input: {
  session: StaffSession
  groupId: string
  templateId: string
}): Promise<BulkPlan> {
  const template = await authorizeTemplateAccess(input.session, input.templateId)
  const companies = await listGroupCompanies(input.session, input.groupId)

  return {
    templateName: template.name,
    readyCount: companies.filter((c) => c.readyToSend).length,
    rows: companies.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      contactName: company.contactName,
      contactPhone: company.contactPhone,
      contactEmail: company.contactEmail,
      ready: company.readyToSend,
      reason: company.readyToSend
        ? null
        : !company.contactName?.trim()
          ? 'חסר שם איש קשר'
          : 'חסר טלפון או אימייל',
    })),
  }
}

/**
 * Creates the batch and sends. Safe to call again with the same batch id to
 * retry only what did not go out.
 */
export async function runBulkSend(input: {
  session: StaffSession
  groupId: string
  templateId: string
  companyIds: string[]
  /** Continue an existing batch instead of starting one. */
  batchId?: string
}): Promise<BulkResult> {
  const db = getDb()
  const group = await authorizeGroup(input.session, input.groupId)
  const template = await authorizeTemplateAccess(input.session, input.templateId)

  let batchId = input.batchId
  if (batchId) {
    const [existing] = await db
      .select({ id: schema.bulkBatches.id })
      .from(schema.bulkBatches)
      .where(
        and(
          eq(schema.bulkBatches.id, batchId),
          eq(schema.bulkBatches.organizationId, input.session.organizationId),
        ),
      )
      .limit(1)
    if (!existing) throw new Error('batch not found')
  } else {
    const [batch] = await db
      .insert(schema.bulkBatches)
      .values({
        organizationId: input.session.organizationId,
        groupId: group.id,
        templateId: template.id,
        // Names as they were: a later rename must not rewrite what happened.
        groupName: group.name,
        templateName: template.name,
        createdBy: input.session.userId,
        totalRequested: input.companyIds.length,
      })
      .returning({ id: schema.bulkBatches.id })
    batchId = batch.id

    // One row per company up front, so the batch describes the whole intent
    // even if the process dies halfway through.
    if (input.companyIds.length > 0) {
      await db
        .insert(schema.bulkBatchItems)
        .values(input.companyIds.map((companyId) => ({ batchId: batch.id, companyId })))
        .onConflictDoNothing()
    }
  }

  const pending = await db
    .select({
      companyId: schema.bulkBatchItems.companyId,
      status: schema.bulkBatchItems.status,
      agreementId: schema.bulkBatchItems.agreementId,
    })
    .from(schema.bulkBatchItems)
    .where(eq(schema.bulkBatchItems.batchId, batchId))

  const companies = await listGroupCompanies(input.session, input.groupId)
  const byId = new Map(companies.map((c) => [c.id, c]))

  let sent = 0
  let skipped = 0
  const failed: { companyName: string; reason: string }[] = []

  // Only what has not already gone out. This is what makes a retry safe.
  const todo = pending.filter((row) => row.status !== 'sent')
  skipped = pending.length - todo.length

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK)
    await Promise.all(
      chunk.map(async (row) => {
        const company = byId.get(row.companyId)
        if (!company) {
          await markItem(batchId!, row.companyId, 'failed', 'החברה כבר אינה בקבוצה')
          failed.push({ companyName: row.companyId, reason: 'החברה כבר אינה בקבוצה' })
          return
        }
        if (!company.readyToSend) {
          await markItem(batchId!, row.companyId, 'skipped', 'חסרים פרטי נמען')
          failed.push({ companyName: company.name, reason: 'חסרים פרטי נמען' })
          return
        }

        try {
          // A previous attempt may have created the document and then failed to
          // send it. Reusing that agreement is what keeps a retry from leaving
          // the company with two copies of the same thing.
          let agreementId = row.agreementId
          if (!agreementId) {
            const created = await createDocumentFromTemplate({
              session: input.session,
              templateId: template.id,
              companyId: company.id,
            })
            if (!created.ok) {
              await markItem(batchId!, row.companyId, 'failed', created.message)
              failed.push({ companyName: company.name, reason: created.message })
              return
            }
            agreementId = created.agreementId
            // Recorded immediately, so even a crash between here and the send
            // leaves the retry something to find.
            await markItem(batchId!, row.companyId, 'pending', null, agreementId)
          }

          // The recipient is seeded from the company at creation; this makes
          // sure it is there even for a company whose contact was added later.
          await saveRecipient({
            session: input.session,
            agreementId,
            name: company.contactName ?? company.name,
            company: company.name,
            phone: company.contactPhone,
            email: company.contactEmail,
          })

          const channels: ('sms' | 'email')[] = []
          if (company.contactPhone) channels.push('sms')
          if (company.contactEmail) channels.push('email')

          const result = await sendAgreement({
            session: input.session,
            agreementId,
            channels,
          })

          if (!result.ok) {
            await markItem(batchId!, row.companyId, 'failed', result.blockers.join(', '), agreementId)
            failed.push({ companyName: company.name, reason: result.blockers.join(', ') })
            return
          }

          await markItem(batchId!, row.companyId, 'sent', null, agreementId)
          sent += 1
        } catch (error) {
          log.error('bulk send item failed', { companyId: company.id, error: String(error) })
          await markItem(batchId!, row.companyId, 'failed', 'שגיאה בשליחה')
          failed.push({ companyName: company.name, reason: 'שגיאה בשליחה' })
        }
      }),
    )
  }

  return { batchId: batchId!, sent, failed, skipped }
}

async function markItem(
  batchId: string,
  companyId: string,
  status: 'sent' | 'failed' | 'skipped' | 'pending',
  error: string | null,
  agreementId?: string,
): Promise<void> {
  await getDb()
    .update(schema.bulkBatchItems)
    .set({ status, error, updatedAt: new Date(), ...(agreementId ? { agreementId } : {}) })
    .where(
      and(eq(schema.bulkBatchItems.batchId, batchId), eq(schema.bulkBatchItems.companyId, companyId)),
    )
}

export type BatchSummary = {
  id: string
  groupName: string | null
  templateName: string | null
  createdAt: Date
  total: number
  sent: number
  failed: number
  signed: number
}

/** Past sends for a group — what went out, and what came back. */
export async function listBatches(session: StaffSession, groupId: string): Promise<BatchSummary[]> {
  await authorizeGroup(session, groupId)
  const db = getDb()

  const batches = await db
    .select()
    .from(schema.bulkBatches)
    .where(
      and(
        eq(schema.bulkBatches.organizationId, session.organizationId),
        eq(schema.bulkBatches.groupId, groupId),
      ),
    )
    .orderBy(schema.bulkBatches.createdAt)

  const summaries: BatchSummary[] = []
  for (const batch of batches) {
    const items = await db
      .select({ status: schema.bulkBatchItems.status, agreementId: schema.bulkBatchItems.agreementId })
      .from(schema.bulkBatchItems)
      .where(eq(schema.bulkBatchItems.batchId, batch.id))

    const agreementIds = items.map((i) => i.agreementId).filter(Boolean) as string[]
    let signed = 0
    if (agreementIds.length > 0) {
      const rows = await db
        .select({ id: schema.agreements.id })
        .from(schema.agreements)
        .where(and(eq(schema.agreements.status, 'signed')))
      const signedSet = new Set(rows.map((r) => r.id))
      signed = agreementIds.filter((id) => signedSet.has(id)).length
    }

    summaries.push({
      id: batch.id,
      groupName: batch.groupName,
      templateName: batch.templateName,
      createdAt: batch.createdAt,
      total: items.length,
      sent: items.filter((i) => i.status === 'sent').length,
      failed: items.filter((i) => i.status === 'failed' || i.status === 'skipped').length,
      signed,
    })
  }

  return summaries.reverse()
}
