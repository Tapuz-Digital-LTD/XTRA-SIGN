import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { FireberryProvider } from '../fireberry'
import { syncFromFireberry } from '../sync'

/** Against the real Postgres, with Fireberry's read mocked. */

const db = getDb()
let orgId: string
let session: StaffSession
let suffix: string
let n = 0

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  process.env.FIREBERRY_API_TOKEN = 'test-token'
  const [org] = await db.insert(schema.organizations).values({ name: `S ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `s-${suffix}@x.test`, name: 'a', phone: `+9725${String(++n).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: `s-${suffix}@x.test`, name: 'a', isAdmin: true }
})

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.crmSyncState).where(eq(schema.crmSyncState.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
  delete process.env.FIREBERRY_API_TOKEN
})

/** Mock queryRecords per object type; one page each. */
function mockFireberry(customers: Record<string, unknown>[], suppliers: Record<string, unknown>[]) {
  vi.spyOn(FireberryProvider.prototype, 'queryRecords').mockImplementation(async ({ objectType }) => ({
    rows: objectType === 1 ? customers : objectType === 1000 ? suppliers : [],
    isLastPage: true,
  }))
}

describe('syncFromFireberry', () => {
  const custId = () => `cust-${suffix}-${++n}`
  const supId = () => `sup-${suffix}-${++n}`

  it('imports customers and suppliers, saving the Fireberry id, and is idempotent', async () => {
    const c1 = custId()
    const s1 = supId()
    mockFireberry(
      [{ accountid: c1, accountname: 'מקדונלדס', idnumber: '511', telephone1: '03-1', emailaddress1: 'a@b.co', billingstreet: 'רחוב 1', billingcity: 'תל אביב', modifiedon: '2026-09-01T10:00:00' }],
      [{ customobject1000id: s1, name: 'כיתן', pcfvatid: '512', pcfsystemfield129: 'דנה', pcfsystemfield130: '050-2', pcfsystemfield103: 'c@d.co', pcfstreet: 'רחוב 2', pcfcity: 'חיפה', modifiedon: '2026-09-01T09:00:00' }],
    )

    const first = await syncFromFireberry(session)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(first.counts.added).toBe(2)

    const customers = await db.select().from(schema.companies).where(eq(schema.companies.crmRecordId, c1))
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({ kind: 'customer', crmObjectType: 1, source: 'crm', name: 'מקדונלדס', taxId: '511' })
    expect(customers[0].crmSyncedAt).not.toBeNull()
    expect(customers[0].address).toContain('תל אביב')

    // Running again with identical data creates nothing and changes nothing.
    const second = await syncFromFireberry(session)
    if (!second.ok) return
    expect(second.counts.added).toBe(0)
    expect(second.counts.unchanged).toBe(2)
    // Still exactly one row per Fireberry id.
    expect(await db.select().from(schema.companies).where(eq(schema.companies.crmRecordId, c1))).toHaveLength(1)

    // The watermark advanced to the newest modifiedon seen, so the next run is
    // incremental rather than a full re-pull.
    const [state] = await db
      .select()
      .from(schema.crmSyncState)
      .where(eq(schema.crmSyncState.objectType, 1))
    expect(state?.watermark).toBe('2026-09-01T10:00:00')
  })

  it('updates an existing record in place when a field changes', async () => {
    const c = custId()
    mockFireberry([{ accountid: c, accountname: 'שם ישן', idnumber: '900' }], [])
    await syncFromFireberry(session)

    mockFireberry([{ accountid: c, accountname: 'שם חדש', idnumber: '900' }], [])
    const result = await syncFromFireberry(session)
    if (!result.ok) return
    expect(result.counts.updated).toBe(1)

    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.crmRecordId, c))
    expect(row.name).toBe('שם חדש')
  })

  it('fails a row with no id, and imports an unnamed one as "(ללא שם)"', async () => {
    const unnamed = custId()
    mockFireberry([{ accountid: '', accountname: 'no id' }, { accountid: unnamed, accountname: '' }], [])
    const result = await syncFromFireberry(session)
    if (!result.ok) return
    // No id means nothing to upsert by — that is a failure. No *name* is a data
    // gap in the CRM, and a real record must not vanish because of it.
    expect(result.counts.failed).toBe(1)
    expect(result.counts.added).toBe(1)

    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.crmRecordId, unnamed))
    expect(row.name).toBe('(ללא שם)')
  })
})

describe('isPlaceholderName', () => {
  it('treats filler as no name', async () => {
    const { isPlaceholderName } = await import('../sync')
    for (const junk of ['-', '.', '?', '--', ' ', 'א', '/', null]) {
      expect(isPlaceholderName(junk as string | null)).toBe(true)
    }
  })
  it('keeps real names, short ones included', async () => {
    const { isPlaceholderName } = await import('../sync')
    for (const real of ['3M', 'מקדונלד\'ס ישראל', 'HP', 'א.ב שיווק']) {
      expect(isPlaceholderName(real)).toBe(false)
    }
  })
})
