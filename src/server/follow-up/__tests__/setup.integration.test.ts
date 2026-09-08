import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { bulkUpdateTasks, createTasksAfterSignature, tasksForCompany, updateTask } from '../tasks'

/**
 * The setup screen's promises: a bulk change lands on the selected tasks and
 * on no other; closing a task leaves the agreement exactly as signed; one
 * registration never carries the same task twice; a company's card sees its
 * newest task first.
 */

const db = getDb()
let orgId: string
let userId: string
let session: StaffSession
let groupId: string

async function company() {
  const [row] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  return row.id
}

async function signed(companyId: string, completedAt = new Date('2026-09-01T10:00:00Z')) {
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: userId, companyId, title: 'A', status: 'signed', sentAt: completedAt, completedAt })
    .returning({ id: schema.agreements.id })
  const [lead] = await db
    .insert(schema.projectLeads)
    .values({ organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: 'עסק' }, companyId, agreementId: agreement.id })
    .returning({ id: schema.projectLeads.id })
  await createTasksAfterSignature(agreement.id)
  const [task] = await db.select().from(schema.followUpTasks).where(eq(schema.followUpTasks.leadId, lead.id))
  return { agreementId: agreement.id, leadId: lead.id, task }
}

const taskById = async (id: string) => (await db.select().from(schema.followUpTasks).where(eq(schema.followUpTasks.id, id)))[0]
const agreementById = async (id: string) => (await db.select({ status: schema.agreements.status, completedAt: schema.agreements.completedAt }).from(schema.agreements).where(eq(schema.agreements.id, id)))[0]

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Setup ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  userId = u.id
  session = { userId, organizationId: orgId, email: 'o@xtra.test', name: 'Owner', isAdmin: true }
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Setup', createdBy: userId, campaignKind: 'public', followUpConfig: { afterSign: ['site_product'] } }).returning({ id: schema.groups.id })
  groupId = g.id
})

describe('bulkUpdateTasks', () => {
  it('changes only the selected tasks and counts what it could not touch', async () => {
    const c = await company()
    const [a, b, untouched] = [await signed(c), await signed(c), await signed(c)]

    expect(await bulkUpdateTasks(session, [a.task.id, b.task.id, crypto.randomUUID()], { status: 'in_progress', assigneeUserId: userId })).toEqual({ updated: 2, failed: 1 })
    expect(await taskById(a.task.id)).toMatchObject({ status: 'in_progress', assigneeUserId: userId })
    expect(await taskById(b.task.id)).toMatchObject({ status: 'in_progress', assigneeUserId: userId })
    expect(await taskById(untouched.task.id)).toMatchObject({ status: 'pending', assigneeUserId: null, dueAt: null })

    // A due date alone leaves the status where it was; null clears it.
    expect(await bulkUpdateTasks(session, [untouched.task.id], { dueAt: new Date('2026-10-01T00:00:00Z') })).toEqual({ updated: 1, failed: 0 })
    expect(await taskById(untouched.task.id)).toMatchObject({ status: 'pending', dueAt: new Date('2026-10-01T00:00:00Z') })
    await bulkUpdateTasks(session, [untouched.task.id], { dueAt: null })
    expect((await taskById(untouched.task.id)).dueAt).toBeNull()

    // Another organization's session moves nothing.
    expect(await bulkUpdateTasks({ ...session, organizationId: crypto.randomUUID() }, [a.task.id], { status: 'done' })).toEqual({ updated: 0, failed: 1 })
    expect((await taskById(a.task.id)).status).toBe('in_progress')
  })
})

describe('marking a task done', () => {
  it('never changes the agreement status or completedAt, one by one or in bulk', async () => {
    const completedAt = new Date('2026-08-15T08:30:00Z')
    const c = await company()
    const one = await signed(c, completedAt)
    const many = await signed(c, completedAt)

    expect(await updateTask(session, one.task.id, { status: 'done', link: 'www.site.co.il/p/1' })).toMatchObject({ status: 'done', link: 'https://www.site.co.il/p/1' })
    expect(await bulkUpdateTasks(session, [many.task.id], { status: 'done' })).toEqual({ updated: 1, failed: 0 })
    await bulkUpdateTasks(session, [one.task.id, many.task.id], { status: 'not_needed' })

    for (const id of [one.agreementId, many.agreementId]) {
      expect(await agreementById(id)).toEqual({ status: 'signed', completedAt })
    }
  })
})

describe('one task per registration', () => {
  it('cannot be created twice for the same lead', async () => {
    const c = await company()
    const { agreementId, leadId, task } = await signed(c)
    await createTasksAfterSignature(agreementId)
    const values = { organizationId: orgId, groupId, leadId, agreementId, companyId: c, kind: 'site_product', title: 'הקמת מוצר באתר' }
    expect(await db.insert(schema.followUpTasks).values(values).onConflictDoNothing().returning({ id: schema.followUpTasks.id })).toEqual([])
    await expect(db.insert(schema.followUpTasks).values(values)).rejects.toThrow()
    expect((await db.select().from(schema.followUpTasks).where(eq(schema.followUpTasks.leadId, leadId))).map((t) => t.id)).toEqual([task.id])
  })
})

describe('tasksForCompany', () => {
  it('returns the newest first, this organization only', async () => {
    const c = await company()
    const older = await signed(c)
    await db.update(schema.followUpTasks).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(schema.followUpTasks.id, older.task.id))
    const newer = await signed(c)

    expect((await tasksForCompany(orgId, c)).map((t) => t.id)).toEqual([newer.task.id, older.task.id])
    expect(await tasksForCompany(crypto.randomUUID(), c)).toEqual([])
    expect(await tasksForCompany(orgId, 'not-a-uuid')).toEqual([])
    expect(await tasksForCompany(orgId, await company())).toEqual([])
  })
})
