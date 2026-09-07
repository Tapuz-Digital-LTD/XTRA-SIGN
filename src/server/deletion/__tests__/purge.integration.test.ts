import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createCompany } from '@/server/companies/companies'
import { purgeEntity } from '../purge'

/**
 * The owner's full delete: refused for anyone else (an admin included),
 * and for the owner it takes the record with everything under it — the
 * signed agreement, its version, recipient and audit — and leaves one
 * admin audit line saying so.
 */

const db = getDb()
let owner: StaffSession
let admin: StaffSession
let orgId: string

beforeAll(async () => {
  const tag = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Purge ${tag}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const mk = async (name: string, isAdmin: boolean) => {
    const [u] = await db
      .insert(schema.users)
      .values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name, phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin })
      .returning({ id: schema.users.id, email: schema.users.email })
    return { userId: u.id, organizationId: orgId, email: u.email, name, isAdmin } satisfies StaffSession
  }
  const o = await mk('Owner', true)
  await db.update(schema.organizations).set({ ownerUserId: o.userId }).where(eq(schema.organizations.id, orgId))
  owner = { ...o, isOwner: true }
  admin = { ...(await mk('Admin', true)), isOwner: false }
})

async function signedCompany() {
  const created = await createCompany({ session: owner, kind: 'supplier', data: { name: `Signed ${crypto.randomUUID().slice(0, 6)}` } })
  if (!created.ok) throw new Error(created.message)
  const [a] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: owner.userId, companyId: created.id, title: 'A signed', status: 'signed', sentAt: new Date(), completedAt: new Date() })
    .returning({ id: schema.agreements.id })
  const [v] = await db.insert(schema.agreementVersions).values({ agreementId: a.id, versionNumber: 1 }).returning({ id: schema.agreementVersions.id })
  const [r] = await db.insert(schema.recipients).values({ agreementId: a.id, name: 'חותם', phone: '+972500000001', email: null }).returning({ id: schema.recipients.id })
  await db.insert(schema.auditEvents).values({ agreementId: a.id, recipientId: r.id, type: 'completed', actor: 'signer' })
  return { companyId: created.id, agreementId: a.id, versionId: v.id, recipientId: r.id }
}

describe('purge (owner only)', () => {
  it('refuses anyone who is not the owner, even an admin', async () => {
    const { companyId } = await signedCompany()
    const result = await purgeEntity(admin, 'company', companyId)
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.companies).where(eq(schema.companies.id, companyId))).toHaveLength(1)
  })

  it('takes a company with its signed agreement, version, recipient and audit, and records it', async () => {
    const { companyId, agreementId, versionId, recipientId } = await signedCompany()
    const result = await purgeEntity(owner, 'company', companyId)
    expect(result.ok).toBe(true)
    expect(await db.select().from(schema.companies).where(eq(schema.companies.id, companyId))).toHaveLength(0)
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId))).toHaveLength(0)
    expect(await db.select().from(schema.agreementVersions).where(eq(schema.agreementVersions.id, versionId))).toHaveLength(0)
    expect(await db.select().from(schema.recipients).where(eq(schema.recipients.id, recipientId))).toHaveLength(0)
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, agreementId))).toHaveLength(0)
    const audit = await db.select().from(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, orgId))
    const line = audit.find((a) => a.type === 'record_purged' && (a.metadata as { id?: string }).id === companyId)
    expect(line?.actorEmail).toBe(owner.email)
  })

  it('does not reach into another organization', async () => {
    const { companyId } = await signedCompany()
    const stranger: StaffSession = { ...owner, organizationId: crypto.randomUUID(), isOwner: true }
    const result = await purgeEntity(stranger, 'company', companyId)
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.companies).where(eq(schema.companies.id, companyId))).toHaveLength(1)
  })
})
