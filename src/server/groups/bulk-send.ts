import { and, eq, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { saveRecipient } from '@/server/documents/save-fields'
import { resendAgreement, sendAgreement } from '@/server/documents/send-agreement'
import type { Channel } from '@/server/documents/send-validation'
import { log } from '@/server/log'
import { authorizeGroup, listGroupCompanies } from '@/server/groups/groups'
import { isUuid } from '@/server/documents/authorization'
import { createDocumentFromTemplate } from '@/server/templates/templates'
import { authorizeTemplateAccess, templateAutoFields } from '@/server/templates/templates'
import { autoSourceLabel, personalize } from '@/server/documents/personalization'

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
  /** The company's own values for the template's auto fields, for the preview. */
  personalized: { label: string; value: string }[]
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
  const [companies, autoFields] = await Promise.all([
    listGroupCompanies(input.session, input.groupId),
    templateAutoFields(input.session, input.templateId),
  ])
  const now = new Date()

  const rows: BulkPlanRow[] = companies.map((company) => {
    const { values, missing } = personalize(autoFields, company, now)

    // A company can be reachable and still not be sendable: an agreement whose
    // "ח.פ" line comes out blank is not one to put a signature on.
    const contactReason = !company.contactName?.trim()
      ? 'חסר שם איש קשר'
      : !company.contactPhone && !company.contactEmail
        ? 'חסר טלפון או אימייל'
        : null
    const dataReason = missing.length
      ? `חסר במסמך: ${missing.map((gap) => autoSourceLabel(gap.source)).join(', ')}`
      : null
    const reason = contactReason ?? dataReason

    return {
      companyId: company.id,
      companyName: company.name,
      contactName: company.contactName,
      contactPhone: company.contactPhone,
      contactEmail: company.contactEmail,
      ready: reason === null,
      reason,
      personalized: autoFields
        .filter((field) => values.has(field.id))
        .map((field) => ({ label: field.label, value: values.get(field.id)! })),
    }
  })

  return {
    templateName: template.name,
    rows,
    readyCount: rows.filter((row) => row.ready).length,
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

  // The company ids arrive from the browser, so they are a request, not a fact.
  // Intersecting them with the group's real membership is what stops a crafted
  // request from creating and sending agreements for companies the caller was
  // never shown — including ones in another organization.
  const members = new Set(
    (await listGroupCompanies(input.session, group.id)).map((company) => company.id),
  )
  const companyIds = input.companyIds.filter((id) => members.has(id))
  if (companyIds.length !== input.companyIds.length) {
    log.warn('bulk send dropped unauthorized companies', {
      groupId: group.id,
      requested: input.companyIds.length,
      allowed: companyIds.length,
    })
  }

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
        totalRequested: companyIds.length,
      })
      .returning({ id: schema.bulkBatches.id })
    batchId = batch.id

    // One row per company up front, so the batch describes the whole intent
    // even if the process dies halfway through.
    if (companyIds.length > 0) {
      await db
        .insert(schema.bulkBatchItems)
        .values(companyIds.map((companyId) => ({ batchId: batch.id, companyId })))
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

export type BulkRemindResult = {
  requested: number
  /** How many of the requested suppliers hold an agreement a reminder can reach. */
  eligible: number
  sent: number
  failed: number
}

/**
 * A reminder to the ticked suppliers — and only to the ones a reminder can
 * legally reach: their latest agreement from this project is still waiting
 * (sent/viewed). Everyone else is counted out, never guessed at.
 */
export async function bulkRemind(input: {
  session: StaffSession
  groupId: string
  companyIds: string[]
}): Promise<BulkRemindResult> {
  const group = await authorizeGroup(input.session, input.groupId)
  const requestedIds = [...new Set(input.companyIds)].filter(isUuid).slice(0, 200)
  if (requestedIds.length === 0) return { requested: 0, eligible: 0, sent: 0, failed: 0 }
  // node-postgres wants a Postgres array literal; a JS array binds as a scalar.
  const idArray = `{${requestedIds.join(',')}}`

  // The latest agreement per requested supplier, from THIS project's sends.
  const latest = await getDb().execute(sql`
    select distinct on (bi.company_id) bi.company_id, bi.agreement_id, a.status::text as status
    from ${schema.bulkBatchItems} bi
    join ${schema.bulkBatches} bb on bb.id = bi.batch_id
    left join ${schema.agreements} a on a.id = bi.agreement_id
    where bb.group_id = ${group.id}
      and bi.company_id = any(${idArray}::uuid[])
    order by bi.company_id, bi.updated_at desc
  `)

  const eligible = (latest.rows as { company_id: string; agreement_id: string | null; status: string | null }[])
    .filter((row) => row.agreement_id && (row.status === 'sent' || row.status === 'viewed'))

  let sent = 0
  let failed = 0
  for (const row of eligible) {
    const [recipient] = await getDb()
      .select({ phone: schema.recipients.phone, email: schema.recipients.email })
      .from(schema.recipients)
      .where(eq(schema.recipients.agreementId, row.agreement_id!))
      .limit(1)
    const channels: Channel[] = [
      ...(recipient?.phone ? (['sms'] as const) : []),
      ...(recipient?.email ? (['email'] as const) : []),
    ]
    if (channels.length === 0) {
      failed++
      continue
    }
    try {
      const result = await resendAgreement({ session: input.session, agreementId: row.agreement_id!, channels })
      if (result.ok) sent++
      else failed++
    } catch (error) {
      log.error('bulk remind failed', { agreementId: row.agreement_id, error: String(error) })
      failed++
    }
  }

  return { requested: requestedIds.length, eligible: eligible.length, sent, failed }
}
