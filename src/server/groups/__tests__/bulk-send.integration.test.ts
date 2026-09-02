import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import * as send from '@/server/documents/send-agreement'
import { createGroup } from '../groups'
import { planBulkSend, runBulkSend } from '../bulk-send'

/** The property that matters: pressing send twice must not send twice. */

const PDF = Buffer.from(
  '255044462d312e340a312030206f626a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e656e646f626a0a322030206f626a3c3c2f54797065' +
    '2f50616765732f4b6964735b33203020525d2f436f756e7420313e3e656e646f626a0a332030206f626a3c3c2f547970652f506167652f506172656e742032203020' +
    '522f4d65646961426f785b30203020353935203834325d3e3e656e646f626a0a747261696c65723c3c2f526f6f742031203020523e3e0a2525454f46',
  'hex',
)

const db = getDb()
let orgId: string
let session: StaffSession
let groupId: string
let templateId: string
let readyIds: string[] = []

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `B ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `b-${suffix}@x.test`, name: 'a', phone: `+9729${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `b-${suffix}@x.test`, name: 'a', isAdmin: true }

  const companies = await db
    .insert(schema.companies)
    .values([
      { organizationId: orgId, kind: 'supplier', name: 'מוכן א', contactName: 'דנה', contactPhone: '+972501111111' },
      { organizationId: orgId, kind: 'supplier', name: 'מוכן ב', contactName: 'רון', contactEmail: 'ron@example.com' },
      { organizationId: orgId, kind: 'supplier', name: 'חסר נמען' },
    ])
    .returning({ id: schema.companies.id })
  readyIds = [companies[0].id, companies[1].id]

  const group = await createGroup({ session, name: 'קבוצת בדיקה', companyIds: companies.map((c) => c.id) })
  if (!group.ok) throw new Error(group.message)
  groupId = group.id

  const [template] = await db
    .insert(schema.templates)
    .values({ organizationId: orgId, name: 'תבנית בדיקה', fields: [], pageCount: 1, createdBy: user.id })
    .returning({ id: schema.templates.id })
  templateId = template.id

  const { getStorage } = await import('@/server/storage/blob')
  const key = `org/${orgId}/templates/${template.id}/source/test.pdf`
  await getStorage().put(key, PDF, 'application/pdf')
  await db.update(schema.templates).set({ sourceFileKey: key }).where(eq(schema.templates.id, template.id))
})

afterAll(async () => {
  const ags = await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  for (const a of ags) {
    const vs = await db.select({ id: schema.agreementVersions.id }).from(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
    for (const v of vs) {
      await db.delete(schema.fields).where(eq(schema.fields.agreementVersionId, v.id))
      await db.delete(schema.documentPages).where(eq(schema.documentPages.agreementVersionId, v.id))
    }
    const rs = await db.select({ id: schema.recipients.id }).from(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
    for (const r of rs) {
      await db.delete(schema.deliveries).where(eq(schema.deliveries.recipientId, r.id))
      await db.delete(schema.signingTokens).where(eq(schema.signingTokens.recipientId, r.id))
    }
    await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
    await db.update(schema.agreements).set({ currentVersionId: null }).where(eq(schema.agreements.id, a.id))
    await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
  }
  const batches = await db.select({ id: schema.bulkBatches.id }).from(schema.bulkBatches).where(eq(schema.bulkBatches.organizationId, orgId))
  for (const b of batches) await db.delete(schema.bulkBatchItems).where(eq(schema.bulkBatchItems.batchId, b.id))
  await db.delete(schema.bulkBatches).where(eq(schema.bulkBatches.organizationId, orgId))
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.notifications).where(eq(schema.notifications.organizationId, orgId))
  const grps = await db.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.organizationId, orgId))
  for (const g of grps) await db.delete(schema.companyGroups).where(eq(schema.companyGroups.groupId, g.id))
  await db.delete(schema.groups).where(eq(schema.groups.organizationId, orgId))
  await db.delete(schema.templates).where(eq(schema.templates.organizationId, orgId))
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

describe('planBulkSend', () => {
  it('says who is ready and why the rest are not, before anything is created', async () => {
    const plan = await planBulkSend({ session, groupId, templateId })
    expect(plan.rows).toHaveLength(3)
    expect(plan.readyCount).toBe(2)
    const blocked = plan.rows.find((r) => !r.ready)!
    expect(blocked.companyName).toBe('חסר נמען')
    expect(blocked.reason).toBe('חסר שם איש קשר')
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).toHaveLength(0)
  })
})

describe('runBulkSend', () => {
  it('creates a separate agreement per company, filed to it', async () => {
    vi.spyOn(send, 'sendAgreement').mockResolvedValue({ ok: true, results: [] } as never)

    const result = await runBulkSend({ session, groupId, templateId, companyIds: readyIds })
    expect(result.sent).toBe(2)
    expect(result.failed).toEqual([])

    const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
    expect(agreements).toHaveLength(2)
    expect(new Set(agreements.map((a) => a.companyId))).toEqual(new Set(readyIds))
    vi.restoreAllMocks()
  })

  it('re-running the same batch sends nothing again', async () => {
    const spy = vi.spyOn(send, 'sendAgreement').mockResolvedValue({ ok: true, results: [] } as never)

    const [batch] = await db.select().from(schema.bulkBatches).where(eq(schema.bulkBatches.organizationId, orgId))
    const again = await runBulkSend({ session, groupId, templateId, companyIds: readyIds, batchId: batch.id })

    expect(again.sent).toBe(0)
    expect(again.skipped).toBe(2)
    expect(spy).not.toHaveBeenCalled()
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).toHaveLength(2)
    vi.restoreAllMocks()
  })
})

describe('retrying failures', () => {
  it('reuses the agreement a failed attempt already created', async () => {
    // A batch where the send fails: the documents exist, the sends do not.
    vi.spyOn(send, 'sendAgreement').mockResolvedValue({ ok: false, blockers: ['ספק לא זמין'] } as never)
    const first = await runBulkSend({ session, groupId, templateId, companyIds: readyIds })
    expect(first.sent).toBe(0)
    expect(first.failed).toHaveLength(2)

    const afterFirst = (await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).length
    vi.restoreAllMocks()

    // Now it works. The retry must send those same two, not make two more.
    vi.spyOn(send, 'sendAgreement').mockResolvedValue({ ok: true, results: [] } as never)
    const retry = await runBulkSend({ session, groupId, templateId, companyIds: readyIds, batchId: first.batchId })

    expect(retry.sent).toBe(2)
    const afterRetry = (await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).length
    expect(afterRetry).toBe(afterFirst)

    const items = await db.select().from(schema.bulkBatchItems).where(eq(schema.bulkBatchItems.batchId, first.batchId))
    expect(items.every((i) => i.status === 'sent' && i.agreementId)).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('runBulkSend authorization', () => {
  it('ignores company ids that are not in the group', async () => {
    const spy = vi.spyOn(send, 'sendAgreement').mockResolvedValue({ ok: true, results: [] } as never)

    // A company that exists in the organization but was never added to the
    // group. The browser can name it; the server must not act on it.
    const [outsider] = await db
      .insert(schema.companies)
      .values({
        organizationId: orgId,
        name: 'מחוץ לקבוצה',
        kind: 'customer',
        contactName: 'איש קשר',
        contactPhone: '+972500000099',
      })
      .returning()

    const result = await runBulkSend({
      session,
      groupId,
      templateId,
      companyIds: [...readyIds, outsider.id],
    })

    expect(result.sent).toBe(2)
    const agreements = await db
      .select()
      .from(schema.agreements)
      .where(eq(schema.agreements.organizationId, orgId))
    expect(agreements.some((a) => a.companyId === outsider.id)).toBe(false)

    spy.mockRestore()
  })
})
