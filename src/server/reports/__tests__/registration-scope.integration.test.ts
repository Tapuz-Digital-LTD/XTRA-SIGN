import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { listDocuments } from '@/server/documents/queries'
import { createInvitation, listAudience } from '@/server/invitations/invitations'
import { registrationCount, registrationRows } from '../project-report'

/**
 * הרשמות lists only people who actually submitted the campaign's form;
 * הזמנות ומעקב lists everyone the campaign reached. One row per person in
 * the database, two views of it — never a duplicate, never a lost failure.
 */

const db = getDb()
let orgId: string
let session: StaffSession
let groupId: string

const submittedRow = (over: Partial<typeof schema.projectLeads.$inferInsert>) => ({ organizationId: orgId, groupId, status: 'converted' as const, source: 'self_service', data: { name: 'x' }, formSnapshot: [{ id: 'name', label: 'שם' }], ...over })

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Scope ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: 'rep@xtra.test', name: 'Rep', isAdmin: true }
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Scope', createdBy: session.userId, campaignKind: 'public', goal: 'signing', entryMethod: 'custom', landingSlug: `scope-${crypto.randomUUID().slice(0, 6)}` }).returning({ id: schema.groups.id })
  groupId = g.id
})

const registrationNames = async () => (await registrationRows(groupId, {} as never, 100)).map((r) => r.businessName)
const trackingNames = async () => (await listAudience(session, groupId)).rows.map((r) => r.name)

describe('registrations vs. tracking', () => {
  it('an invitation only: in tracking, not in registrations', async () => {
    const created = await createInvitation(session, { groupId, name: 'רק הוזמן', phone: '0500000701', kind: 'supplier' })
    expect(created.ok).toBe(true)
    expect(await trackingNames()).toContain('רק הוזמן')
    expect(await registrationNames()).not.toContain('רק הוזמן')
    expect(await registrationCount(groupId, {} as never)).toBe(0)
  })

  it('an invitation that then submitted the form: in both, as one row', async () => {
    const created = await createInvitation(session, { groupId, name: 'הוזמן ונרשם', phone: '0500000702', kind: 'supplier' })
    if (!created.ok) throw new Error(created.message)
    // What the registration flow does when the invited person submits: the same row, now with a snapshot.
    await db.update(schema.projectLeads).set({ status: 'converted', source: 'self_service', formSnapshot: [{ id: 'name', label: 'שם' }], data: { name: 'הוזמן ונרשם', businessName: 'הוזמן ונרשם' } }).where(eq(schema.projectLeads.id, created.invitation.id))
    expect(await trackingNames()).toContain('הוזמן ונרשם')
    expect(await registrationNames()).toContain('הוזמן ונרשם')
    const rows = await db.select({ id: schema.projectLeads.id }).from(schema.projectLeads).where(and(eq(schema.projectLeads.groupId, groupId), eq(schema.projectLeads.phone, '+972500000702')))
    expect(rows).toHaveLength(1)
  })

  it('a direct registration with no invitation: in registrations', async () => {
    await db.insert(schema.projectLeads).values(submittedRow({ data: { name: 'ישיר', businessName: 'ישיר' } }))
    expect(await registrationNames()).toContain('ישיר')
    expect(await trackingNames()).toContain('ישיר')
  })

  it('a submission that failed afterwards stays in registrations with its failure', async () => {
    await db.insert(schema.projectLeads).values(submittedRow({ status: 'failed', data: { name: 'נכשל אחרי שליחה', businessName: 'נכשל אחרי שליחה' }, meta: { error: 'ההסכם לא נוצר' } }))
    const rows = await registrationRows(groupId, {} as never, 100)
    const failed = rows.find((r) => r.businessName === 'נכשל אחרי שליחה')
    expect(failed).toBeTruthy()
    expect(failed?.statusLabel).toBe('שליחה נכשלה')
    expect(await registrationCount(groupId, { status: 'failed' } as never)).toBeGreaterThanOrEqual(1)
  })

  it('a claim still being processed is not listed; a completed signature appears once in registrations and once in agreements', async () => {
    await db.insert(schema.projectLeads).values(submittedRow({ status: 'pending', data: { name: 'בעיבוד', businessName: 'בעיבוד' } }))
    expect(await registrationNames()).not.toContain('בעיבוד')

    const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: 'חתם', source: 'xtra' }).returning({ id: schema.companies.id })
    const [agreement] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: session.userId, companyId: company.id, title: 'הסכם', status: 'signed', sentAt: new Date(), completedAt: new Date() }).returning({ id: schema.agreements.id })
    await db.insert(schema.projectLeads).values(submittedRow({ data: { name: 'חתם', businessName: 'חתם' }, companyId: company.id, agreementId: agreement.id }))
    const registrations = (await registrationRows(groupId, {} as never, 100)).filter((r) => r.businessName === 'חתם')
    expect(registrations).toHaveLength(1)
    expect(registrations[0].statusLabel).toBe('נחתם')
    const docs = await listDocuments(session, { groupId, pageSize: 100 })
    expect(docs.items.filter((d) => d.id === agreement.id)).toHaveLength(1)
    // Never an English status on screen.
    for (const r of await registrationRows(groupId, {} as never, 100)) expect(/^[a-z_]+$/.test(r.statusLabel)).toBe(false)
  })
})
