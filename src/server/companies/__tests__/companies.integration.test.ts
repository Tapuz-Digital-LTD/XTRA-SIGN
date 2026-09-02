import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  resolveOwnCompanyId,
  updateCompany,
} from '../companies'

/** Against the real Postgres. */

const db = getDb()
let orgId: string
let otherOrgId: string
let admin: StaffSession
let plain: StaffSession
let otherAdmin: StaffSession
let suffix: string
let phoneSeq = 0
const phone = () => `05${String(++phoneSeq).padStart(2, '0')}${Math.floor(Math.random() * 1e6)}`.slice(0, 12)

async function seedUser(organizationId: string, isAdmin: boolean): Promise<StaffSession> {
  const email = `co-${suffix}-${Math.random().toString(36).slice(2, 8)}@x.test`
  const [u] = await db
    .insert(schema.users)
    .values({ organizationId, email, name: email, phone: `+9725${String(++phoneSeq).padStart(8, '0')}`, isAdmin })
    .returning({ id: schema.users.id })
  return { userId: u.id, organizationId, email, name: email, isAdmin }
}

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  const [o1] = await db.insert(schema.organizations).values({ name: `C ${suffix}` }).returning({ id: schema.organizations.id })
  const [o2] = await db.insert(schema.organizations).values({ name: `C2 ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = o1.id
  otherOrgId = o2.id
  admin = await seedUser(orgId, true)
  plain = await seedUser(orgId, false)
  otherAdmin = await seedUser(otherOrgId, true)
})

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) {
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.organizationId, id))
    for (const u of users) {
      await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, schema.agreements.id)).catch(() => {})
    }
    await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, id))
    await db.delete(schema.companies).where(eq(schema.companies.organizationId, id))
    await db.delete(schema.users).where(eq(schema.users.organizationId, id))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, id))
  }
})

describe('companies', () => {
  it('creates a supplier and finds it in the supplier space, not the customer space', async () => {
    const created = await createCompany({ session: admin, kind: 'supplier', data: { name: `מקדונלדס ${suffix}`, taxId: '515123456' } })
    expect(created).toMatchObject({ ok: true })

    const suppliers = await listCompanies(admin, 'supplier')
    expect(suppliers.map((c) => c.name)).toContain(`מקדונלדס ${suffix}`)

    const customers = await listCompanies(admin, 'customer')
    expect(customers.map((c) => c.name)).not.toContain(`מקדונלדס ${suffix}`)
  })

  it('REQUIRES a name', async () => {
    const bad = await createCompany({ session: admin, kind: 'customer', data: { name: '   ' } })
    expect(bad).toMatchObject({ ok: false })
  })

  it('counts a company documents, and hides another tenant company', async () => {
    const mine = await createCompany({ session: admin, kind: 'customer', data: { name: `לקוח ${suffix}` } })
    if (!mine.ok) throw new Error('setup')

    // Two documents filed under the company: one signed, one draft.
    for (const status of ['signed', 'draft'] as const) {
      await db.insert(schema.agreements).values({
        organizationId: orgId,
        companyId: mine.id,
        title: `doc ${status}`,
        status,
        ownerId: admin.userId,
      })
    }

    const [row] = (await listCompanies(admin, 'customer')).filter((c) => c.id === mine.id)
    expect(row.documentCount).toBe(2)
    expect(row.signedCount).toBe(1)

    // Another organization's admin never sees it.
    expect(await getCompany(otherAdmin, mine.id)).toBeNull()
    expect((await listCompanies(otherAdmin, 'customer')).map((c) => c.id)).not.toContain(mine.id)
  })

  it('scopes a non-admin count to their own documents', async () => {
    const co = await createCompany({ session: admin, kind: 'supplier', data: { name: `scoped ${suffix}` } })
    if (!co.ok) throw new Error('setup')

    // A document owned by the admin, not the plain user.
    await db.insert(schema.agreements).values({
      organizationId: orgId,
      companyId: co.id,
      title: 'admin-owned',
      status: 'signed',
      ownerId: admin.userId,
    })

    const asAdmin = (await listCompanies(admin, 'supplier')).find((c) => c.id === co.id)
    const asPlain = (await listCompanies(plain, 'supplier')).find((c) => c.id === co.id)
    // The company is visible to both, but its document count is per-viewer.
    expect(asAdmin?.documentCount).toBe(1)
    expect(asPlain?.documentCount).toBe(0)
  })

  it('updates within the tenant and REFUSES across it', async () => {
    const co = await createCompany({ session: admin, kind: 'supplier', data: { name: `edit ${suffix}` } })
    if (!co.ok) throw new Error('setup')

    expect(await updateCompany({ session: admin, companyId: co.id, data: { name: 'renamed' } })).toMatchObject({ ok: true })
    expect((await getCompany(admin, co.id))?.name).toBe('renamed')

    // Another tenant cannot edit it by id.
    expect(await updateCompany({ session: otherAdmin, companyId: co.id, data: { name: 'hijacked' } })).toMatchObject({ ok: false })
    expect((await getCompany(admin, co.id))?.name).toBe('renamed')
  })

  it('soft-deletes: gone from the list, still resolvable by nothing', async () => {
    const co = await createCompany({ session: admin, kind: 'customer', data: { name: `del ${suffix}` } })
    if (!co.ok) throw new Error('setup')

    expect(await deleteCompany({ session: admin, companyId: co.id })).toMatchObject({ ok: true })
    expect((await listCompanies(admin, 'customer')).map((c) => c.id)).not.toContain(co.id)
    expect(await getCompany(admin, co.id)).toBeNull()
    // A deleted company can no longer be filed against.
    expect(await resolveOwnCompanyId(admin, co.id)).toBeNull()
  })

  it('stores and returns a CRM record id', async () => {
    const co = await createCompany({
      session: admin,
      kind: 'customer',
      data: { name: `crm ${suffix}`, crmRecordId: 'a86e183a-3d1d-4e9e-8074-007e337c9c1c' },
    })
    if (!co.ok) throw new Error('setup')
    expect((await getCompany(admin, co.id))?.crmRecordId).toBe('a86e183a-3d1d-4e9e-8074-007e337c9c1c')

    // Clearing it is possible via update.
    await updateCompany({ session: admin, companyId: co.id, data: { name: `crm ${suffix}`, crmRecordId: '' } })
    expect((await getCompany(admin, co.id))?.crmRecordId).toBeNull()
  })

  it('resolveOwnCompanyId accepts an own id and rejects a foreign one', async () => {
    const mine = await createCompany({ session: admin, kind: 'supplier', data: { name: `resolve ${suffix}` } })
    if (!mine.ok) throw new Error('setup')
    expect(await resolveOwnCompanyId(admin, mine.id)).toBe(mine.id)
    expect(await resolveOwnCompanyId(otherAdmin, mine.id)).toBeNull()
    expect(await resolveOwnCompanyId(admin, null)).toBeNull()
  })
})

describe('input validation', () => {
  it('refuses a phone that is not a phone, and says which field', async () => {
    const result = await createCompany({
      session: admin,
      kind: 'supplier',
      data: { name: 'ספק תקין', contactPhone: 'abc123' },
    })
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.fields?.contactPhone).toBeTruthy()
  })

  it('refuses a malformed email', async () => {
    const result = await createCompany({ session: admin, kind: 'supplier', data: { name: 'ספק', contactEmail: 'not-an-email' } })
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.fields?.contactEmail).toBeTruthy()
  })

  it('requires a name', async () => {
    const result = await createCompany({ session: admin, kind: 'supplier', data: { name: '   ' } })
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.fields?.name).toBeTruthy()
  })

  it('accepts a real Israeli phone and stores it normalised', async () => {
    const result = await createCompany({
      session: admin,
      kind: 'supplier',
      data: { name: `ספק תקין ${crypto.randomUUID().slice(0, 6)}`, contactPhone: '050-123-4567' },
    })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id))
    expect(row.contactPhone).toBe('+972501234567')
  })
})
