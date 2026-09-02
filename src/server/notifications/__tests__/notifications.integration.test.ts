import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { listNotifications, markRead, notify } from '../notifications'

const db = getDb()
let orgId: string
let session: StaffSession
let agreementId: string

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `N ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `n-${suffix}@x.test`, name: 'a', phone: `+9728${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `n-${suffix}@x.test`, name: 'a', isAdmin: true }
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, title: 'מסמך', status: 'signed', ownerId: user.id })
    .returning({ id: schema.agreements.id })
  agreementId = agreement.id
})

afterAll(async () => {
  await db.delete(schema.notifications).where(eq(schema.notifications.organizationId, orgId))
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

describe('notifications', () => {
  it('records an event once, however many times it is reported', async () => {
    await notify({ organizationId: orgId, type: 'signed', agreementId, title: 'נחתם' })
    await notify({ organizationId: orgId, type: 'signed', agreementId, title: 'נחתם שוב' })

    const { items, unread } = await listNotifications(session)
    expect(items.filter((i) => i.type === 'signed')).toHaveLength(1)
    expect(unread).toBe(1)
    // The first title stands; a retry does not rewrite history.
    expect(items[0].title).toBe('נחתם')
  })

  it('keeps different event types apart', async () => {
    await notify({ organizationId: orgId, type: 'crm_failed', agreementId, title: 'העלאה נכשלה' })
    const { items } = await listNotifications(session)
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(['signed', 'crm_failed']))
  })

  it('marks one read, and then all', async () => {
    const before = await listNotifications(session)
    await markRead(session, before.items[0].id)
    expect((await listNotifications(session)).unread).toBe(before.unread - 1)

    await markRead(session)
    expect((await listNotifications(session)).unread).toBe(0)
  })

  it('never throws into the caller when the write fails', async () => {
    // A bad organization id would violate the foreign key; signing must not care.
    await expect(
      notify({ organizationId: '00000000-0000-0000-0000-000000000000', type: 'signed', agreementId: null, title: 'x' }),
    ).resolves.toBeUndefined()
  })
})
