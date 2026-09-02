import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { addCompanies, createGroup, deleteGroup, listGroupCompanies, listGroups, removeCompanies } from '../groups'

const db = getDb()
let orgA: string
let orgB: string
let alice: StaffSession
let bob: StaffSession
let companyIds: string[] = []
let foreignCompany: string

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const orgs = await db
    .insert(schema.organizations)
    .values([{ name: `G-A ${suffix}` }, { name: `G-B ${suffix}` }])
    .returning({ id: schema.organizations.id })
  ;[orgA, orgB] = [orgs[0].id, orgs[1].id]

  const users = await db
    .insert(schema.users)
    .values([
      { organizationId: orgA, email: `ga-${suffix}@x.test`, name: 'a', phone: `+97231${suffix.slice(0, 6)}`, isAdmin: true },
      { organizationId: orgB, email: `gb-${suffix}@x.test`, name: 'b', phone: `+97232${suffix.slice(0, 6)}`, isAdmin: true },
    ])
    .returning({ id: schema.users.id, email: schema.users.email })
  alice = { userId: users[0].id, organizationId: orgA, email: users[0].email, name: 'a', isAdmin: true }
  bob = { userId: users[1].id, organizationId: orgB, email: users[1].email, name: 'b', isAdmin: true }

  const companies = await db
    .insert(schema.companies)
    .values([
      { organizationId: orgA, kind: 'supplier', name: 'ספק א', contactName: 'דנה', contactPhone: '+972501111111' },
      { organizationId: orgA, kind: 'customer', name: 'לקוח ב' },
      { organizationId: orgB, kind: 'supplier', name: 'של ארגון אחר' },
    ])
    .returning({ id: schema.companies.id })
  companyIds = [companies[0].id, companies[1].id]
  foreignCompany = companies[2].id
})

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    const grps = await db.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.organizationId, org))
    for (const g of grps) await db.delete(schema.companyGroups).where(eq(schema.companyGroups.groupId, g.id))
    await db.delete(schema.groups).where(eq(schema.groups.organizationId, org))
    await db.delete(schema.companies).where(eq(schema.companies.organizationId, org))
    await db.delete(schema.users).where(eq(schema.users.organizationId, org))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org))
  }
})

describe('groups', () => {
  it('creates a group seeded from a selection', async () => {
    const result = await createGroup({ session: alice, name: '  ספקי פסח  ', companyIds })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    const groups = await listGroups(alice)
    expect(groups[0].name).toBe('ספקי פסח')
    expect(groups[0].companyCount).toBe(2)
  })

  it('requires a name', async () => {
    expect(await createGroup({ session: alice, name: '   ' })).toMatchObject({ ok: false })
  })

  it('lets a company belong to more than one group', async () => {
    const second = await createGroup({ session: alice, name: 'ספקי מלונות', companyIds: [companyIds[0]] })
    if (!second.ok) return
    const members = await listGroupCompanies(alice, second.id)
    expect(members.map((m) => m.id)).toEqual([companyIds[0]])
  })

  it('adding the same company twice does not duplicate it', async () => {
    const group = (await listGroups(alice)).find((g) => g.name === 'ספקי פסח')!
    const before = (await listGroupCompanies(alice, group.id)).length
    const added = await addCompanies({ session: alice, groupId: group.id, companyIds })
    expect(added.added).toBe(0)
    expect(await listGroupCompanies(alice, group.id)).toHaveLength(before)
  })

  it("silently ignores another organization's company", async () => {
    const group = (await listGroups(alice)).find((g) => g.name === 'ספקי פסח')!
    const result = await addCompanies({ session: alice, groupId: group.id, companyIds: [foreignCompany] })
    expect(result.added).toBe(0)
  })

  it("refuses another organization's group outright", async () => {
    const group = (await listGroups(alice)).find((g) => g.name === 'ספקי פסח')!
    await expect(listGroupCompanies(bob, group.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('marks who can be sent to', async () => {
    const group = (await listGroups(alice)).find((g) => g.name === 'ספקי פסח')!
    const members = await listGroupCompanies(alice, group.id)
    const withContact = members.find((m) => m.name === 'ספק א')!
    const without = members.find((m) => m.name === 'לקוח ב')!
    expect(withContact.readyToSend).toBe(true)
    expect(without.readyToSend).toBe(false)
  })

  it('removing a company from a group leaves the company alone', async () => {
    const group = (await listGroups(alice)).find((g) => g.name === 'ספקי פסח')!
    await removeCompanies({ session: alice, groupId: group.id, companyIds: [companyIds[1]] })

    expect((await listGroupCompanies(alice, group.id)).map((m) => m.id)).not.toContain(companyIds[1])
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyIds[1]))
    expect(company.deletedAt).toBeNull()
  })

  it('deleting a group deletes no companies', async () => {
    const group = await createGroup({ session: alice, name: 'למחיקה', companyIds })
    if (!group.ok) return
    await deleteGroup(alice, group.id)

    expect((await listGroups(alice)).map((g) => g.id)).not.toContain(group.id)
    const rows = await db.select().from(schema.companies).where(eq(schema.companies.organizationId, orgA))
    expect(rows.filter((c) => !c.deletedAt)).toHaveLength(2)
  })
})
