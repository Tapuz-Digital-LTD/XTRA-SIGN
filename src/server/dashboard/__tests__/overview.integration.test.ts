import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getDashboardOverview } from '../overview'

/** Against the real Postgres. */

const db = getDb()
const DAY = 24 * 60 * 60 * 1000
let orgId: string
let admin: StaffSession
let other: StaffSession
let seq = 0

async function seed(input: {
  title: string
  status: 'draft' | 'sent' | 'signed'
  ownerId: string
  expiresAt?: Date
  completedAt?: Date
}) {
  await db.insert(schema.agreements).values({
    organizationId: orgId,
    title: input.title,
    status: input.status,
    ownerId: input.ownerId,
    sentAt: input.status === 'draft' ? null : new Date(),
    expiresAt: input.expiresAt ?? null,
    completedAt: input.completedAt ?? null,
  })
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `D ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const users = await db
    .insert(schema.users)
    .values([
      { organizationId: orgId, email: `dash-a-${suffix}@x.test`, name: 'a', phone: `+9726${String(seq++).padStart(8, '0')}`, isAdmin: true },
      { organizationId: orgId, email: `dash-b-${suffix}@x.test`, name: 'b', phone: `+9726${String(seq++).padStart(8, '0')}`, isAdmin: false },
    ])
    .returning({ id: schema.users.id, email: schema.users.email })
  admin = { userId: users[0].id, organizationId: orgId, email: users[0].email, name: 'a', isAdmin: true }
  other = { userId: users[1].id, organizationId: orgId, email: users[1].email, name: 'b', isAdmin: false }

  await db.insert(schema.companies).values([
    { organizationId: orgId, kind: 'supplier', name: `ספק ${suffix}` },
    { organizationId: orgId, kind: 'supplier', name: `ספק ב ${suffix}` },
    { organizationId: orgId, kind: 'customer', name: `לקוח ${suffix}` },
  ])

  await seed({ title: 'פג', status: 'sent', ownerId: admin.userId, expiresAt: new Date(Date.now() - DAY) })
  await seed({ title: 'עוד יומיים', status: 'sent', ownerId: admin.userId, expiresAt: new Date(Date.now() + 2 * DAY) })
  await seed({ title: 'ללא תפוגה', status: 'sent', ownerId: admin.userId })
  await seed({ title: 'של אחר', status: 'sent', ownerId: other.userId, expiresAt: new Date(Date.now() + 10 * DAY) })
  await seed({ title: 'טיוטה', status: 'draft', ownerId: admin.userId })
  await seed({ title: 'חתום', status: 'signed', ownerId: admin.userId, completedAt: new Date() })
})

afterAll(async () => {
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

describe('getDashboardOverview', () => {
  it('counts documents and companies', async () => {
    const data = await getDashboardOverview(admin)
    expect(data.counts).toEqual({ pending: 4, signed: 1, drafts: 1 })
    expect(data.companies).toEqual({ suppliers: 2, customers: 1 })
  })

  it('puts the soonest expiry first and leaves the undated one last', async () => {
    const data = await getDashboardOverview(admin)
    expect(data.attention.map((a) => a.title)).toEqual(['פג', 'עוד יומיים', 'של אחר', 'ללא תפוגה'])
    expect(data.attention[0].expired).toBe(true)
    expect(data.attention[1].expired).toBe(false)
    expect(data.attention[1].daysLeft).toBe(1) // just under two whole days
    expect(data.attention[3].daysLeft).toBeNull()
  })

  it('shows a non-admin only their own documents', async () => {
    const data = await getDashboardOverview(other)
    expect(data.attention.map((a) => a.title)).toEqual(['של אחר'])
    expect(data.counts).toEqual({ pending: 1, signed: 0, drafts: 0 })
    // Companies are shared across the organization, not owned per user.
    expect(data.companies.suppliers).toBe(2)
  })

  it('lists the most recently signed', async () => {
    const data = await getDashboardOverview(admin)
    expect(data.recentlySigned.map((s) => s.title)).toEqual(['חתום'])
  })
})
