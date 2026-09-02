import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { listDocuments } from '../queries'

/**
 * The inbox has to answer "where is my document" for someone who remembers one
 * thing about it — a phone number, a company, half a title. These cover the
 * searching, the filtering and the computed "needs attention" tab.
 */

const db = getDb()
const DAY = 24 * 60 * 60 * 1000
let orgId: string
let session: StaffSession
let companyId: string

async function seed(input: {
  title: string
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'canceled'
  companyId?: string | null
  sentAt?: Date | null
  expiresAt?: Date | null
  recipient?: { name: string; phone?: string; email?: string }
  failedSend?: boolean
}) {
  const [agreement] = await db
    .insert(schema.agreements)
    .values({
      organizationId: orgId,
      title: input.title,
      status: input.status,
      ownerId: session.userId,
      companyId: input.companyId === undefined ? companyId : input.companyId,
      sentAt: input.sentAt ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: schema.agreements.id })

  if (input.recipient) {
    await db.insert(schema.recipients).values({ agreementId: agreement.id, ...input.recipient })
  }
  if (input.failedSend) {
    await db.insert(schema.auditEvents).values({ agreementId: agreement.id, type: 'sms_failed', actor: 'system' })
  }
  return agreement.id
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `IN ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `in-${suffix}@x.test`, name: 'תומר', phone: `+9725${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `in-${suffix}@x.test`, name: 'תומר', isAdmin: true }

  const [company] = await db
    .insert(schema.companies)
    .values({ organizationId: orgId, kind: 'customer', name: 'מקדונלדס ישראל', crmRecordId: 'crm-1', crmObjectType: 1 })
    .returning({ id: schema.companies.id })
  companyId = company.id

  await seed({ title: 'טיוטה שלי', status: 'draft', recipient: { name: 'דנה כהן', phone: '+972501234567' } })
  await seed({ title: 'ממתין לחתימה', status: 'sent', sentAt: new Date(), expiresAt: new Date(Date.now() + 10 * DAY), recipient: { name: 'ישראל ישראלי', email: 'israel@example.com' } })
  await seed({ title: 'נחתם', status: 'signed', sentAt: new Date(Date.now() - DAY) })
  await seed({ title: 'ללא שיוך', status: 'draft', companyId: null })
  await seed({ title: 'פג תוקף', status: 'sent', sentAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() - DAY) })
  await seed({ title: 'תקוע אחרי צפייה', status: 'viewed', sentAt: new Date(Date.now() - 5 * DAY) })
  await seed({ title: 'כשל שליחה', status: 'sent', sentAt: new Date(), failedSend: true })
})

afterAll(async () => {
  const ags = await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  for (const a of ags) {
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
    await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
  }
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title).sort()

describe('inbox listing', () => {
  it('carries the company, its source and the creator', async () => {
    const result = await listDocuments(session, { search: 'ממתין לחתימה' })
    const [doc] = result.items
    expect(doc.company).toMatchObject({ name: 'מקדונלדס ישראל', kind: 'customer', fromCrm: true })
    expect(doc.createdByName).toBe('תומר')
    expect(doc.recipientEmail).toBe('israel@example.com')
  })

  it('returns lastActivityAt as a real Date, not a driver string', async () => {
    // The aggregate arrives as a timestamp string; anything formatting it will
    // throw on a string. This is that guard.
    const result = await listDocuments(session, { pageSize: 50 })
    for (const doc of result.items) {
      expect(doc.lastActivityAt).toBeInstanceOf(Date)
      expect(Number.isNaN(doc.lastActivityAt.getTime())).toBe(false)
    }
  })

  it('shows a document with no company rather than hiding it', async () => {
    const result = await listDocuments(session, { search: 'ללא שיוך' })
    expect(result.items[0].company).toBeNull()
  })
})

describe('inbox search', () => {
  it.each([
    ['company name', 'מקדונלדס'],
    ['signer name', 'ישראל ישראלי'],
    ['signer phone', '0501234567'],
    ['signer email', 'israel@example.com'],
    ['document title', 'נחתם'],
  ])('finds by %s', async (_label, term) => {
    const result = await listDocuments(session, { search: term })
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('searches the whole set, not just one page', async () => {
    const result = await listDocuments(session, { search: 'ישראל ישראלי', pageSize: 1 })
    expect(result.total).toBeGreaterThan(0)
    expect(result.items).toHaveLength(1)
  })
})

describe('inbox filters', () => {
  it('filters by status', async () => {
    expect(titles(await listDocuments(session, { filter: 'drafts' }))).toEqual(['טיוטה שלי', 'ללא שיוך'])
    expect(titles(await listDocuments(session, { filter: 'signed' }))).toEqual(['נחתם'])
    expect(titles(await listDocuments(session, { filter: 'viewed' }))).toEqual(['תקוע אחרי צפייה'])
  })

  it('collects everything that needs a person, and nothing that does not', async () => {
    const attention = titles(await listDocuments(session, { filter: 'attention' }))
    expect(attention).toEqual(['ללא שיוך', 'כשל שליחה', 'פג תוקף', 'תקוע אחרי צפייה'].sort())
    expect(attention).not.toContain('נחתם')
    expect(attention).not.toContain('ממתין לחתימה')
  })
})

describe('inbox paging', () => {
  it('pages without dropping or repeating rows', async () => {
    const all = await listDocuments(session, { pageSize: 100 })
    const first = await listDocuments(session, { pageSize: 3, page: 1 })
    const second = await listDocuments(session, { pageSize: 3, page: 2 })

    expect(first.total).toBe(all.total)
    expect(first.items).toHaveLength(3)
    const ids = [...first.items, ...second.items].map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('version chains', () => {
  it('lists one row per document, not one per version', async () => {
    const v1 = await seed({ title: 'הסכם רב-גרסאות', status: 'canceled' })
    const [v2] = await db
      .insert(schema.agreements)
      .values({ organizationId: orgId, title: 'הסכם רב-גרסאות', status: 'draft', ownerId: session.userId, companyId, supersedesId: v1 })
      .returning({ id: schema.agreements.id })
    await db
      .insert(schema.agreements)
      .values({ organizationId: orgId, title: 'הסכם רב-גרסאות', status: 'draft', ownerId: session.userId, companyId, supersedesId: v2.id })

    const result = await listDocuments(session, { search: 'רב-גרסאות' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].versionCount).toBe(3)

    // The earlier versions are still there when asked for explicitly.
    const withHistory = await listDocuments(session, { search: 'רב-גרסאות', includeSuperseded: true })
    expect(withHistory.items).toHaveLength(3)
  })
})

describe('counts', () => {
  it('counts a version chain once, so the tiles match the list', async () => {
    const { countDocuments } = await import('../queries')

    const before = await countDocuments(session)
    const [v1] = await db
      .insert(schema.agreements)
      .values({ organizationId: orgId, title: 'ספירת גרסאות', status: 'sent', ownerId: session.userId, companyId, sentAt: new Date() })
      .returning({ id: schema.agreements.id })
    await db
      .insert(schema.agreements)
      .values({ organizationId: orgId, title: 'ספירת גרסאות', status: 'sent', ownerId: session.userId, companyId, sentAt: new Date(), supersedesId: v1.id })

    const after = await countDocuments(session)
    // Two rows added, one document.
    expect(after.pending).toBe(before.pending + 1)

    const listed = await listDocuments(session, { search: 'ספירת גרסאות' })
    expect(listed.items).toHaveLength(1)
    expect(listed.total).toBe(1)
  })
})
