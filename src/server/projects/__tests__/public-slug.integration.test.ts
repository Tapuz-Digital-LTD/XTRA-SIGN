import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createGroup } from '@/server/groups/groups'
import { ensurePublicSlug, getPublicSlugSettings, resolvePublicSlug, setPublicSlug } from '../public-slug'

/**
 * The address of a project changes; where its links land does not break.
 * campaign-a → campaign-b → campaign-c: every old address points straight at
 * the newest, never at the next in line.
 */

const db = getDb()
let admin: StaffSession
let stranger: StaffSession
let projectA: string
let projectB: string
const tag = crypto.randomUUID().slice(0, 6)
const s = (name: string) => `${name}-${tag}`

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Slugs ${tag}` }).returning({ id: schema.organizations.id })
  const [org2] = await db.insert(schema.organizations).values({ name: `Other ${tag}` }).returning({ id: schema.organizations.id })
  const mk = async (organizationId: string) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        organizationId,
        email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`,
        name: 'Admin',
        phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        isAdmin: true,
      })
      .returning({ id: schema.users.id, email: schema.users.email })
    return { userId: user.id, organizationId, email: user.email, name: 'Admin', isAdmin: true } satisfies StaffSession
  }
  admin = await mk(org.id)
  stranger = await mk(org2.id)
  const a = await createGroup({ session: admin, name: 'A', kind: 'supplier' })
  const b = await createGroup({ session: stranger, name: 'B', kind: 'supplier' })
  if (!a.ok || !b.ok) throw new Error('group')
  projectA = a.id
  projectB = b.id
})

describe('public address', () => {
  it('every old address redirects straight to the newest one', async () => {
    expect(await setPublicSlug(admin, projectA, s('campaign-a'))).toMatchObject({ ok: true, slug: s('campaign-a'), unchanged: false })
    expect(await resolvePublicSlug(s('campaign-a'))).toMatchObject({ groupId: projectA, canonical: s('campaign-a'), isAlias: false })

    // Typed as a person types it; stored as an address.
    expect(await setPublicSlug(admin, projectA, ` Campaign B ${tag} `)).toMatchObject({ ok: true, slug: s('campaign-b') })
    expect(await setPublicSlug(admin, projectA, s('campaign-c'))).toMatchObject({ ok: true })

    for (const old of [s('campaign-a'), s('campaign-b')]) {
      expect(await resolvePublicSlug(old)).toMatchObject({ groupId: projectA, canonical: s('campaign-c'), isAlias: true })
    }
    expect(await resolvePublicSlug(s('campaign-c'))).toMatchObject({ canonical: s('campaign-c'), isAlias: false })

    const settings = await getPublicSlugSettings(admin, projectA)
    expect(settings.current).toBe(s('campaign-c'))
    expect(settings.history.map((h) => h.slug).sort()).toEqual([s('campaign-a'), s('campaign-b')])
    expect(settings.history.every((h) => h.replacedAt instanceof Date)).toBe(true)
  })

  it('setting the current address again changes nothing', async () => {
    expect(await setPublicSlug(admin, projectA, s('campaign-c'))).toMatchObject({ ok: true, unchanged: true })
    expect((await getPublicSlugSettings(admin, projectA)).history.length).toBe(2)
  })

  it('a project may take back its own old address; nobody else may take it', async () => {
    expect(await setPublicSlug(stranger, projectB, s('campaign-a'))).toMatchObject({ ok: false })
    expect(await setPublicSlug(stranger, projectB, s('campaign-c'))).toMatchObject({ ok: false })

    expect(await setPublicSlug(admin, projectA, s('campaign-a'))).toMatchObject({ ok: true, slug: s('campaign-a'), unchanged: false })
    expect(await resolvePublicSlug(s('campaign-c'))).toMatchObject({ canonical: s('campaign-a'), isAlias: true })
    expect(await resolvePublicSlug(s('campaign-a'))).toMatchObject({ canonical: s('campaign-a'), isAlias: false })
    // Still exactly one current row.
    const rows = await db.select().from(schema.projectPublicSlugs).where(eq(schema.projectPublicSlugs.groupId, projectA))
    expect(rows.filter((r) => r.isCurrent).length).toBe(1)
  })

  it('refuses reserved and malformed addresses, and strangers', async () => {
    expect(await setPublicSlug(admin, projectA, 'api')).toMatchObject({ ok: false })
    expect(await setPublicSlug(admin, projectA, 'קמפיין')).toMatchObject({ ok: false })
    await expect(setPublicSlug(stranger, projectA, s('hijack'))).rejects.toThrow()
    expect(await resolvePublicSlug('no-such-address')).toBeNull()
  })

  it('a project without an address gets the default, numbered when taken', async () => {
    const c = await createGroup({ session: admin, name: 'C', kind: 'supplier' })
    const d = await createGroup({ session: admin, name: 'D', kind: 'supplier' })
    if (!c.ok || !d.ok) throw new Error('group')
    expect(await ensurePublicSlug(admin, c.id, s('default'))).toBe(s('default'))
    expect(await ensurePublicSlug(admin, d.id, s('default'))).toBe(`${s('default')}-2`)
    expect(await ensurePublicSlug(admin, c.id, s('whatever'))).toBe(s('default'))
  })
})

