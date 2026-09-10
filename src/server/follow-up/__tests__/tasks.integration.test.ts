import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { updateCampaign } from '@/server/groups/groups'
import { backfillTasks, cleanFollowUpConfig, createTasksAfterSignature, listTasks, taskCounts, tasksForLeads, updateTask } from '../tasks'

/**
 * A signature creates the tasks the campaign asked for, once each; a campaign
 * that asked for nothing gets nothing; closing a task stamps who and when,
 * reopening clears it; the backfill counts before it writes and never
 * writes a test registration.
 *
 * A campaign names its own tasks. The oldest campaigns stored bare kinds
 * (`['site_product']`) and must keep working, renaming a task must carry the
 * rows already on the board, and adding one must reach the people who signed
 * before it existed.
 */

const db = getDb()
let orgId: string
let userId: string
let session: StaffSession
let groupOn: string
let groupOff: string

async function signed(groupId: string, over: { name?: string; meta?: Record<string, unknown> } = {}) {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: 'A', status: 'signed', sentAt: new Date(), completedAt: new Date() })
    .returning({ id: schema.agreements.id })
  const [lead] = await db
    .insert(schema.projectLeads)
    .values({ organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: over.name ?? 'עסק' }, meta: over.meta ?? null, companyId: company.id, agreementId: agreement.id })
    .returning({ id: schema.projectLeads.id })
  return { agreementId: agreement.id, leadId: lead.id, companyId: company.id }
}

const tasksOf = (leadId: string) => db.select().from(schema.followUpTasks).where(eq(schema.followUpTasks.leadId, leadId))

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Tasks ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  userId = u.id
  session = { userId, organizationId: orgId, email: 'o@xtra.test', name: 'Owner', isAdmin: true }
  const [on] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'On', createdBy: userId, campaignKind: 'public', followUpConfig: { afterSign: ['site_product', 'bogus'] } }).returning({ id: schema.groups.id })
  groupOn = on.id
  const [off] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Off', createdBy: userId, campaignKind: 'public' }).returning({ id: schema.groups.id })
  groupOff = off.id
})

describe('createTasksAfterSignature', () => {
  it('creates one task per configured kind, with the registration behind it', async () => {
    const { agreementId, leadId, companyId } = await signed(groupOn)
    await createTasksAfterSignature(agreementId)
    const tasks = await tasksOf(leadId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: 'site_product', title: 'הקמת מוצר באתר', status: 'pending', organizationId: orgId, groupId: groupOn, agreementId, companyId })
  })

  it('is idempotent: a second call adds nothing', async () => {
    const { agreementId, leadId } = await signed(groupOn)
    await createTasksAfterSignature(agreementId)
    await createTasksAfterSignature(agreementId)
    expect(await tasksOf(leadId)).toHaveLength(1)
  })

  it('creates nothing when the campaign did not ask, and never throws', async () => {
    const { agreementId, leadId } = await signed(groupOff)
    await createTasksAfterSignature(agreementId)
    expect(await tasksOf(leadId)).toHaveLength(0)
    await expect(createTasksAfterSignature('not-a-uuid')).resolves.toBeUndefined()
    await expect(createTasksAfterSignature(crypto.randomUUID())).resolves.toBeUndefined()
  })
})

describe('updateTask', () => {
  it('stamps completion on done or not_needed, clears it on reopening, and keeps the agreement signed', async () => {
    const { agreementId, leadId } = await signed(groupOn)
    await createTasksAfterSignature(agreementId)
    const [task] = await tasksOf(leadId)

    const done = await updateTask(session, task.id, { status: 'done', link: 'www.site.co.il/p/1', note: '  ok  ' })
    expect(done?.status).toBe('done')
    expect(done?.completedAt).toBeInstanceOf(Date)
    expect(done?.completedBy).toBe(userId)
    expect(done?.link).toBe('https://www.site.co.il/p/1')
    expect(done?.note).toBe('ok')

    const reopened = await updateTask(session, task.id, { status: 'in_progress', assigneeUserId: userId, dueAt: new Date('2026-10-01T00:00:00Z') })
    expect(reopened?.status).toBe('in_progress')
    expect(reopened?.completedAt).toBeNull()
    expect(reopened?.completedBy).toBeNull()
    expect(reopened?.assigneeUserId).toBe(userId)
    expect(reopened?.dueAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')

    const notNeeded = await updateTask(session, task.id, { status: 'not_needed', assigneeUserId: crypto.randomUUID() })
    expect(notNeeded?.completedAt).toBeInstanceOf(Date)
    expect(notNeeded?.assigneeUserId).toBeNull()

    const [agreement] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(agreement.status).toBe('signed')
  })

  it('refuses a task of another organization', async () => {
    const { agreementId, leadId } = await signed(groupOn)
    await createTasksAfterSignature(agreementId)
    const [task] = await tasksOf(leadId)
    const other: StaffSession = { ...session, organizationId: crypto.randomUUID() }
    expect(await updateTask(other, task.id, { status: 'done' })).toBeNull()
    expect((await tasksOf(leadId))[0].status).toBe('pending')
  })
})

describe('counts, lists and backfill', () => {
  it('counts per status and lists per registration, org-scoped', async () => {
    const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Counts', createdBy: userId, campaignKind: 'public', followUpConfig: { afterSign: ['site_product'] } }).returning({ id: schema.groups.id })
    const a = await signed(g.id)
    const b = await signed(g.id)
    await createTasksAfterSignature(a.agreementId)
    await createTasksAfterSignature(b.agreementId)
    const [taskB] = await tasksOf(b.leadId)
    await updateTask(session, taskB.id, { status: 'done' })

    expect(await taskCounts(session, g.id)).toEqual({ pending: 1, in_progress: 0, done: 1, not_needed: 0 })
    expect(await listTasks(session, g.id)).toHaveLength(2)
    expect(await listTasks(session, g.id, { status: 'done' })).toHaveLength(1)
    const byLead = await tasksForLeads(orgId, [a.leadId, b.leadId, crypto.randomUUID()])
    expect(byLead.get(a.leadId)?.[0].status).toBe('pending')
    expect(byLead.get(b.leadId)?.[0].status).toBe('done')
    expect(byLead.size).toBe(2)
    expect(await taskCounts({ ...session, organizationId: crypto.randomUUID() }, g.id)).toEqual({ pending: 0, in_progress: 0, done: 0, not_needed: 0 })
  })

  it('backfill counts on a dry run, writes on apply, skips test rows, and is a no-op when off', async () => {
    const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Backfill', createdBy: userId, campaignKind: 'public', followUpConfig: { afterSign: ['site_product'] } }).returning({ id: schema.groups.id })
    const done = await signed(g.id)
    await createTasksAfterSignature(done.agreementId)
    const missing1 = await signed(g.id)
    const missing2 = await signed(g.id)
    const testByName = await signed(g.id, { name: 'בדיקה של הטופס' })
    const testByMeta = await signed(g.id, { meta: { test: true } })

    expect(await backfillTasks(g.id, { apply: false })).toEqual({ candidates: 2, created: 0, skipped: 2 })
    expect(await tasksOf(missing1.leadId)).toHaveLength(0)

    expect(await backfillTasks(g.id, { apply: true })).toEqual({ candidates: 2, created: 2, skipped: 2 })
    expect(await tasksOf(missing1.leadId)).toHaveLength(1)
    expect(await tasksOf(missing2.leadId)).toHaveLength(1)
    expect(await tasksOf(testByName.leadId)).toHaveLength(0)
    expect(await tasksOf(testByMeta.leadId)).toHaveLength(0)
    expect(await tasksOf(done.leadId)).toHaveLength(1)

    expect(await backfillTasks(g.id, { apply: true })).toEqual({ candidates: 0, created: 0, skipped: 2 })
    expect(await backfillTasks(groupOff, { apply: true })).toEqual({ candidates: 0, created: 0, skipped: 0 })
  })
})

describe('a campaign names its own tasks', () => {
  it('reads the old bare-kind config and the named one alike', () => {
    // What the first campaigns stored, and what they mean now.
    expect(cleanFollowUpConfig({ afterSign: ['site_product'] })).toEqual({ afterSign: [{ key: 'site_product', label: 'הקמת מוצר באתר' }] })
    expect(cleanFollowUpConfig({ afterSign: [{ key: 'site_product', label: 'הקמה באתר' }, { key: 't_ab12cd34', label: 'שליחת נראות לספק' }] })).toEqual({
      afterSign: [
        { key: 'site_product', label: 'הקמה באתר' },
        { key: 't_ab12cd34', label: 'שליחת נראות לספק' },
      ],
    })
    // A nameless task is not a task; neither is a second row of the same key.
    expect(cleanFollowUpConfig({ afterSign: [{ key: 't_1', label: '  ' }, { key: 'no spaces allowed', label: 'x' }, 'bogus', { key: 't_2', label: 'ניקיון' }, { key: 't_2', label: 'שוב' }] })).toEqual({
      afterSign: [{ key: 't_2', label: 'ניקיון' }],
    })
    expect(cleanFollowUpConfig(null).afterSign).toEqual([])
    expect(cleanFollowUpConfig({ afterSign: Array.from({ length: 30 }, (_, i) => ({ key: `t_${i}`, label: `משימה ${i}` })) }).afterSign).toHaveLength(12)
  })

  it('opens one row per task, renames them where they stand, and reaches whoever signed before', async () => {
    const [g] = await db
      .insert(schema.groups)
      .values({
        organizationId: orgId,
        name: `Many ${crypto.randomUUID().slice(0, 6)}`,
        createdBy: userId,
        campaignKind: 'public',
        followUpConfig: { afterSign: [{ key: 'site_product', label: 'הקמת מוצר באתר' }, { key: 't_visual', label: 'שליחת נראות לספק' }] },
      })
      .returning({ id: schema.groups.id })

    const first = await signed(g.id)
    await createTasksAfterSignature(first.agreementId)
    const opened = await tasksOf(first.leadId)
    expect(opened.map((t) => [t.kind, t.title]).sort()).toEqual([
      ['site_product', 'הקמת מוצר באתר'],
      ['t_visual', 'שליחת נראות לספק'],
    ])
    expect(await taskCounts(session, g.id)).toMatchObject({ pending: 2 })
    // One task at a time, for the tab that shows one.
    expect(await taskCounts(session, g.id, 't_visual')).toMatchObject({ pending: 1 })

    // A rename reaches the work already on the board, and opens nothing new.
    const renamed = await updateCampaign(session, g.id, { followUpConfig: { afterSign: [{ key: 'site_product', label: 'הקמת מוצר באתר' }, { key: 't_visual', label: 'שליחת נראות ואישור' }] } })
    expect(renamed).toEqual({ ok: true })
    expect((await tasksOf(first.leadId)).find((t) => t.kind === 't_visual')?.title).toBe('שליחת נראות ואישור')
    expect(await tasksOf(first.leadId)).toHaveLength(2)

    // A task added later reaches everyone who already signed, once.
    const second = await signed(g.id)
    await createTasksAfterSignature(second.agreementId)
    await updateCampaign(session, g.id, {
      followUpConfig: { afterSign: [{ key: 'site_product', label: 'הקמת מוצר באתר' }, { key: 't_visual', label: 'שליחת נראות ואישור' }, { key: 't_call', label: 'שיחת פתיחה' }] },
    })
    expect(await backfillTasks(g.id, { apply: true })).toMatchObject({ candidates: 2, created: 2 })
    expect((await tasksOf(second.leadId)).map((t) => t.kind).sort()).toEqual(['site_product', 't_call', 't_visual'])
    expect(await backfillTasks(g.id, { apply: true })).toMatchObject({ candidates: 0, created: 0 })

    // Removing a task from the list stops it opening; what is open stays open.
    await updateCampaign(session, g.id, { followUpConfig: { afterSign: [{ key: 'site_product', label: 'הקמת מוצר באתר' }] } })
    const third = await signed(g.id)
    await createTasksAfterSignature(third.agreementId)
    expect((await tasksOf(third.leadId)).map((t) => t.kind)).toEqual(['site_product'])
    expect(await tasksOf(first.leadId)).toHaveLength(3)
  })
})
