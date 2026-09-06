import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createGroup } from '@/server/groups/groups'
import { createCompany } from '@/server/companies/companies'
import { deleteEntity, getDeletionImpact } from '../policy'

/**
 * The policy, end to end: nothing behind it → gone; unsigned work → cancelled
 * and gone; signed history → never deleted, archived or removed by an admin
 * with the signed rows untouched; the admin audit knows about each.
 */

const db = getDb()
let admin: StaffSession
let user: StaffSession
let orgId: string

async function company(name: string) {
  const result = await createCompany({ session: admin, kind: 'supplier', data: { name } })
  if (!result.ok) throw new Error(result.message)
  return result.id
}

async function agreement(companyId: string, status: 'draft' | 'sent' | 'signed' | 'expired', ownerId = admin.userId) {
  const [row] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId, companyId, title: `A ${status}`, status, sentAt: status === 'draft' ? null : new Date(), completedAt: status === 'signed' ? new Date() : null })
    .returning({ id: schema.agreements.id })
  await db.insert(schema.auditEvents).values({ agreementId: row.id, type: 'created', actor: 'sender' })
  return row.id
}

beforeAll(async () => {
  const tag = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Del ${tag}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const mk = async (isAdmin: boolean) => {
    const [u] = await db
      .insert(schema.users)
      .values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: isAdmin ? 'Admin' : 'User', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin })
      .returning({ id: schema.users.id, email: schema.users.email })
    return { userId: u.id, organizationId: orgId, email: u.email, name: isAdmin ? 'Admin' : 'User', isAdmin } satisfies StaffSession
  }
  admin = await mk(true)
  user = await mk(false)
})

describe('deletion policy', () => {
  it('a company with nothing behind it is deleted outright', async () => {
    const id = await company('Empty')
    const impact = await getDeletionImpact(admin, 'company', id)
    expect(impact).toMatchObject({ canHardDelete: true, requiresAdmin: false, recommendedAction: 'delete' })
    const result = await deleteEntity(user, 'company', id, { mode: 'delete' })
    expect(result.ok).toBe(true)
    expect(await db.select().from(schema.companies).where(eq(schema.companies.id, id))).toHaveLength(0)
    const audit = await db.select().from(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, orgId))
    expect(audit.some((a) => a.type === 'record_deleted' && (a.metadata as { entityId?: string }).entityId === id)).toBe(true)
  })

  it('unsigned work is cancelled, drafts removed, and the record leaves the lists', async () => {
    const id = await company('Open')
    const sent = await agreement(id, 'sent')
    const draft = await agreement(id, 'draft')
    const impact = await getDeletionImpact(admin, 'company', id)
    expect(impact).toMatchObject({ recommendedAction: 'delete_with_cancel', openAgreements: 1, draftAgreements: 1, requiresAdmin: false })
    const result = await deleteEntity(admin, 'company', id, { mode: 'delete' })
    expect(result.ok).toBe(true)
    const [after] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, sent))
    expect(after.status).toBe('canceled')
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.id, draft))).toHaveLength(0)
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, id))
    expect(row.deletedAt).not.toBeNull()
  })

  it('signed history is never deleted: archive, or a protected admin removal that keeps everything', async () => {
    const id = await company('Signed')
    const signed = await agreement(id, 'signed')
    const impact = await getDeletionImpact(user, 'company', id)
    expect(impact).toMatchObject({ canHardDelete: false, requiresAdmin: true, recommendedAction: 'archive', signedAgreements: 1 })

    const refused = await deleteEntity(user, 'company', id, { mode: 'delete' })
    expect(refused).toMatchObject({ ok: false, requiresAdmin: true })
    const notAdmin = await deleteEntity(user, 'company', id, { mode: 'protected', acknowledged: true })
    expect(notAdmin).toMatchObject({ ok: false, requiresAdmin: true })

    const archived = await deleteEntity(user, 'company', id, { mode: 'archive' })
    expect(archived.ok).toBe(true)
    expect((await db.select().from(schema.companies).where(eq(schema.companies.id, id)))[0].archivedAt).not.toBeNull()
    const restored = await deleteEntity(user, 'company', id, { mode: 'restore' })
    expect(restored.ok).toBe(true)

    const unacknowledged = await deleteEntity(admin, 'company', id, { mode: 'protected' })
    expect(unacknowledged.ok).toBe(false)
    const removed = await deleteEntity(admin, 'company', id, { mode: 'protected', acknowledged: true })
    expect(removed.ok).toBe(true)
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, id))
    expect(row.deletedAt).not.toBeNull()
    // The signed agreement and its audit are exactly where they were.
    const [still] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, signed))
    expect(still.status).toBe('signed')
    expect(still.deletedAt).toBeNull()
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, signed))).toHaveLength(1)
    const audit = await db.select().from(schema.adminAuditEvents).where(and(eq(schema.adminAuditEvents.organizationId, orgId), eq(schema.adminAuditEvents.type, 'record_protected_delete')))
    expect(audit.length).toBeGreaterThan(0)
  })

  it('a signed agreement is archived, and an admin may remove it from every screen', async () => {
    const id = await company('AgreementHolder')
    const signed = await agreement(id, 'signed', user.userId)
    expect(await getDeletionImpact(admin, 'agreement', signed)).toMatchObject({ requiresAdmin: true, recommendedAction: 'archive' })
    expect(await deleteEntity(user, 'agreement', signed, { mode: 'delete' })).toMatchObject({ ok: false, requiresAdmin: true })
    expect((await deleteEntity(user, 'agreement', signed, { mode: 'archive' })).ok).toBe(true)
    expect((await deleteEntity(admin, 'agreement', signed, { mode: 'protected', acknowledged: true })).ok).toBe(true)
    const [row] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, signed))
    expect(row.status).toBe('signed')
    expect(row.deletedAt).not.toBeNull()
    const trail = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, signed))
    expect(trail.map((t) => t.type)).toEqual(expect.arrayContaining(['created', 'archived', 'removed']))
  })

  it('an empty project is deleted; one with signed agreements is archived', async () => {
    const empty = await createGroup({ session: admin, name: 'Empty project', kind: 'supplier' })
    if (!empty.ok) throw new Error(empty.message)
    expect(await getDeletionImpact(admin, 'project', empty.id)).toMatchObject({ canHardDelete: true, recommendedAction: 'delete' })
    expect((await deleteEntity(admin, 'project', empty.id, { mode: 'delete' })).ok).toBe(true)
    expect(await db.select().from(schema.groups).where(eq(schema.groups.id, empty.id))).toHaveLength(0)

    const busy = await createGroup({ session: admin, name: 'Busy project', kind: 'supplier' })
    if (!busy.ok) throw new Error(busy.message)
    const supplier = await company('Member')
    const signed = await agreement(supplier, 'signed')
    await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: busy.id, status: 'converted', data: { name: 'Member' }, companyId: supplier, agreementId: signed, source: 'self_service' })
    expect(await getDeletionImpact(admin, 'project', busy.id)).toMatchObject({ requiresAdmin: true, recommendedAction: 'archive', signedAgreements: 1 })
    expect(await deleteEntity(admin, 'project', busy.id, { mode: 'delete' })).toMatchObject({ ok: false, requiresAdmin: true })
    expect((await deleteEntity(admin, 'project', busy.id, { mode: 'archive' })).ok).toBe(true)
  })

  it('a converted registration is kept; an unconverted one goes', async () => {
    const group = await createGroup({ session: admin, name: 'Leads', kind: 'supplier' })
    if (!group.ok) throw new Error(group.message)
    const [fresh] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: group.id, status: 'new', data: { name: 'Fresh' } }).returning({ id: schema.projectLeads.id })
    const supplier = await company('Converted')
    const [done] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: group.id, status: 'approved', data: { name: 'Done' }, companyId: supplier }).returning({ id: schema.projectLeads.id })
    expect(await getDeletionImpact(admin, 'lead', done.id)).toMatchObject({ recommendedAction: 'keep' })
    expect((await deleteEntity(admin, 'lead', done.id, { mode: 'delete' })).ok).toBe(false)
    expect((await deleteEntity(admin, 'lead', fresh.id, { mode: 'delete' })).ok).toBe(true)
    expect(await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, fresh.id))).toHaveLength(0)
  })

  it('a stranger cannot even look', async () => {
    const [otherOrg] = await db.insert(schema.organizations).values({ name: 'Other' }).returning({ id: schema.organizations.id })
    const stranger: StaffSession = { userId: admin.userId, organizationId: otherOrg.id, email: 'x@y.test', name: 'X', isAdmin: true }
    const id = await company('Mine')
    await expect(getDeletionImpact(stranger, 'company', id)).rejects.toThrow()
  })
})
