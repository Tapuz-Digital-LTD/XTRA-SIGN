import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { listCompanies } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { addCompanyTags, bulkEditCompanies, createTag, deleteTag, listTags, normalizeTagName, removeCompanyTags, renameTag, tagsForCompanies } from '../tags'

const db = getDb()
let session: StaffSession
let other: StaffSession

async function org(name: string): Promise<StaffSession> {
  const [o] = await db.insert(schema.organizations).values({ name: `${name} ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  const [u] = await db
    .insert(schema.users)
    .values({ organizationId: o.id, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id })
  return { userId: u.id, organizationId: o.id, email: 'o@xtra.test', name: 'Owner', isAdmin: true }
}

async function company(s: StaffSession, notes: string | null = null): Promise<string> {
  const [c] = await db
    .insert(schema.companies)
    .values({ organizationId: s.organizationId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra', notes })
    .returning({ id: schema.companies.id })
  return c.id
}

async function tag(s: StaffSession, name: string): Promise<string> {
  const result = await createTag(s, { name, kind: 'company' })
  if (!result.ok) throw new Error(result.message)
  return result.tag.id
}

beforeAll(async () => {
  session = await org('Tags')
  other = await org('Other')
})

describe('tag names', () => {
  it('normalises spacing and case into one key, keeps the spelling for display', async () => {
    expect(normalizeTagName('  ספק   מועדף ')).toBe('ספק מועדף')
    expect(normalizeTagName('VIP Client')).toBe('vip client')

    const a = await createTag(session, { name: 'ספק  מועדף', kind: 'company' })
    const b = await createTag(session, { name: ' ספק מועדף ', kind: 'company' })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.tag.id).toBe(a.tag.id)
    expect(a.tag.name).toBe('ספק מועדף')

    const campaign = await createTag(session, { name: 'ספק מועדף', kind: 'campaign' })
    expect(campaign.ok && campaign.tag.id !== a.tag.id).toBe(true)
    expect((await listTags(session, 'company')).some((t) => t.id === a.tag.id)).toBe(true)
    expect((await listTags(session, 'campaign')).some((t) => t.id === a.tag.id)).toBe(false)
  })

  it('rename refuses a name another tag already has, and an empty one', async () => {
    const a = await tag(session, 'א')
    await tag(session, 'ב')
    expect((await renameTag(session, a, 'ב')).ok).toBe(false)
    expect((await renameTag(session, a, '   ')).ok).toBe(false)
    const renamed = await renameTag(session, a, 'ג')
    expect(renamed.ok && renamed.tag.name === 'ג').toBe(true)
  })
})

describe('adding and removing', () => {
  it('add keeps the tags a company already has; remove takes only the listed ones', async () => {
    const c = await company(session)
    const [t1, t2, t3] = await Promise.all([tag(session, 'one'), tag(session, 'two'), tag(session, 'three')])

    expect(await addCompanyTags(session, [c], [t1])).toEqual({ updated: 1, skipped: 0 })
    expect(await addCompanyTags(session, [c], [t1, t2])).toEqual({ updated: 1, skipped: 0 })
    expect(await addCompanyTags(session, [c], [t1, t2])).toEqual({ updated: 0, skipped: 1 })
    expect((await tagsForCompanies(session.organizationId, [c])).get(c)?.map((t) => t.id).sort()).toEqual([t1, t2].sort())

    expect(await removeCompanyTags(session, [c], [t2, t3])).toEqual({ updated: 1, skipped: 0 })
    expect(await removeCompanyTags(session, [c], [t3])).toEqual({ updated: 0, skipped: 1 })
    expect((await tagsForCompanies(session.organizationId, [c])).get(c)?.map((t) => t.id)).toEqual([t1])
  })

  it('ignores companies and tags of another organization', async () => {
    const mine = await company(session)
    const theirs = await company(other)
    const myTag = await tag(session, 'mine')
    const theirTag = await tag(other, 'theirs')

    expect(await addCompanyTags(session, [mine, theirs], [myTag, theirTag])).toEqual({ updated: 1, skipped: 0 })
    const links = await db.select().from(schema.companyTags).where(eq(schema.companyTags.companyId, theirs))
    expect(links).toHaveLength(0)
    expect((await tagsForCompanies(session.organizationId, [mine])).get(mine)?.map((t) => t.id)).toEqual([myTag])
    expect((await tagsForCompanies(other.organizationId, [mine])).size).toBe(0)
  })

  it('deleting a tag is admin-only and takes its links with it', async () => {
    const c = await company(session)
    const t = await tag(session, 'gone')
    await addCompanyTags(session, [c], [t])
    await expect(deleteTag({ ...session, isAdmin: false }, t)).rejects.toThrow()
    expect((await deleteTag(other, t)).ok).toBe(false)
    expect((await deleteTag(session, t)).ok).toBe(true)
    expect(await db.select().from(schema.companyTags).where(eq(schema.companyTags.tagId, t))).toHaveLength(0)
  })
})

describe('filtering the list', () => {
  it('"all" needs every tag, "any" needs one', async () => {
    const s = await org('Filter')
    const [a, b, none] = await Promise.all([company(s), company(s), company(s)])
    const [t1, t2] = await Promise.all([tag(s, 'x'), tag(s, 'y')])
    await addCompanyTags(s, [a], [t1, t2])
    await addCompanyTags(s, [b], [t1])

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()
    expect(ids(await listCompanies(s, 'supplier', undefined, undefined, false, undefined, { ids: [t1, t2], mode: 'all' }))).toEqual([a])
    expect(ids(await listCompanies(s, 'supplier', undefined, undefined, false, undefined, { ids: [t1, t2], mode: 'any' }))).toEqual([a, b].sort())
    expect(ids(await listCompanies(s, 'supplier', undefined, undefined, false, undefined, { ids: [t2], mode: 'any' }))).toEqual([a])
    const all = await listCompanies(s, 'supplier')
    expect(ids(all)).toEqual([a, b, none].sort())
    expect(all.find((r) => r.id === a)?.tags.map((t) => t.id).sort()).toEqual([t1, t2].sort())
    expect(all.find((r) => r.id === none)?.tags).toEqual([])
  })
})

describe('bulk edit', () => {
  it('preview counts and writes nothing', async () => {
    const c = await company(session, 'ישן')
    const t = await tag(session, 'preview')
    const result = await bulkEditCompanies(session, { companyIds: [c, crypto.randomUUID(), 'junk'], action: 'add_tags', tagIds: [t], preview: true })
    expect(result).toEqual({ ok: true, eligible: 1, updated: 0, skipped: 0 })
    expect((await tagsForCompanies(session.organizationId, [c])).size).toBe(0)

    const note = await bulkEditCompanies(session, { companyIds: [c], action: 'notes', notes: 'חדש', preview: true })
    expect(note.ok && note.eligible === 1).toBe(true)
    const [row] = await db.select({ notes: schema.companies.notes }).from(schema.companies).where(eq(schema.companies.id, c))
    expect(row.notes).toBe('ישן')
  })

  it('a note is appended as a new line, never replacing what was there', async () => {
    const withNotes = await company(session, 'שורה ראשונה')
    const empty = await company(session)
    const result = await bulkEditCompanies(session, { companyIds: [withNotes, empty], action: 'notes', notes: '  הערה   חדשה ', preview: false })
    expect(result).toEqual({ ok: true, eligible: 2, updated: 2, skipped: 0 })
    const rows = await db.select({ id: schema.companies.id, notes: schema.companies.notes }).from(schema.companies).where(eq(schema.companies.organizationId, session.organizationId))
    expect(rows.find((r) => r.id === withNotes)?.notes).toBe('שורה ראשונה\nהערה חדשה')
    expect(rows.find((r) => r.id === empty)?.notes).toBe('הערה חדשה')
    expect((await bulkEditCompanies(session, { companyIds: [empty], action: 'notes', notes: '  ', preview: false })).ok).toBe(false)
  })

  it('tags actions report eligible, updated and skipped', async () => {
    const [a, b] = await Promise.all([company(session), company(session)])
    const t = await tag(session, 'bulk')
    await addCompanyTags(session, [a], [t])
    expect(await bulkEditCompanies(session, { companyIds: [a, b], action: 'add_tags', tagIds: [t], preview: false })).toEqual({ ok: true, eligible: 2, updated: 1, skipped: 1 })
    expect(await bulkEditCompanies(session, { companyIds: [a, b], action: 'remove_tags', tagIds: [t], preview: false })).toEqual({ ok: true, eligible: 2, updated: 2, skipped: 0 })
    expect((await bulkEditCompanies(session, { companyIds: [a], action: 'add_tags', tagIds: [], preview: false })).ok).toBe(false)
  })
})
