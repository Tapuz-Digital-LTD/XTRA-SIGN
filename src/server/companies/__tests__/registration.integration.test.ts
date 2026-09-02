import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import * as crm from '@/server/crm/company-registration'
import { FireberryProvider } from '@/server/crm/fireberry'
import { linkExistingCrmRecord, registerCompany } from '../registration'

/**
 * The rule under test: a company always exists here, and a CRM record is never
 * created when one plausibly already exists.
 */

const db = getDb()
let orgId: string
let session: StaffSession

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `REG ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `reg-${suffix}@x.test`, name: 'a', phone: `+9724${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `reg-${suffix}@x.test`, name: 'a', isAdmin: true }
  process.env.FIREBERRY_API_TOKEN ||= 'test-token'
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
})

afterAll(async () => {
  await db.delete(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

const details = { name: 'מקדונלדס בדיקה', taxId: '512345678', contactName: 'ישראל', contactPhone: '0501112233', contactEmail: 'a@b.com' }

describe('registerCompany', () => {
  it('saves locally only when that is what was asked', async () => {
    const find = vi.spyOn(crm, 'findCrmMatches')
    const result = await registerCompany({ session, kind: 'customer', data: details, target: 'local' })

    expect(result).toMatchObject({ ok: true, outcome: 'created' })
    expect(find).not.toHaveBeenCalled() // no CRM traffic at all

    if (!result.ok || result.outcome !== 'created') return
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id))
    expect(row.crmRecordId).toBeNull()
  })

  it('stops on a duplicate and writes nothing anywhere', async () => {
    vi.spyOn(crm, 'findCrmMatches').mockResolvedValue([
      { crmRecordId: 'crm-1', crmObjectType: 1, name: 'מקדונלדס', taxId: '512345678', contactPhone: null, contactEmail: null, matchedOn: 'taxId' },
    ])
    const create = vi.spyOn(crm, 'createCrmCompany')

    const result = await registerCompany({ session, kind: 'customer', data: details, target: 'crm' })

    expect(result).toMatchObject({ ok: true, outcome: 'duplicates' })
    expect(create).not.toHaveBeenCalled()
    expect(await db.select().from(schema.companies).where(eq(schema.companies.organizationId, orgId))).toHaveLength(0)
  })

  it('creates in both and links when there is no match', async () => {
    vi.spyOn(crm, 'findCrmMatches').mockResolvedValue([])
    vi.spyOn(crm, 'createCrmCompany').mockResolvedValue({ crmRecordId: 'crm-new', crmObjectType: 1 })

    const result = await registerCompany({ session, kind: 'customer', data: details, target: 'crm' })
    expect(result).toMatchObject({ ok: true, outcome: 'created_and_linked' })
    if (!result.ok || result.outcome !== 'created_and_linked') return

    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id))
    expect(row.crmRecordId).toBe('crm-new')
    expect(row.source).toBe('crm')
  })

  it('keeps the local company and says so when Fireberry refuses', async () => {
    vi.spyOn(crm, 'findCrmMatches').mockResolvedValue([])
    vi.spyOn(crm, 'createCrmCompany').mockRejectedValue(new Error('CRM down'))

    const result = await registerCompany({ session, kind: 'supplier', data: details, target: 'crm' })
    expect(result).toMatchObject({ ok: true, outcome: 'created_crm_failed' })
    if (!result.ok || result.outcome !== 'created_crm_failed') return

    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id))
    // Saved here, and honestly still not a CRM company.
    expect(row.crmRecordId).toBeNull()
    expect(result.message).toContain('XTRA Sign')
  })

  it('refuses to proceed when the duplicate search itself fails', async () => {
    vi.spyOn(crm, 'findCrmMatches').mockRejectedValue(new Error('duplicate_search_failed'))
    const create = vi.spyOn(crm, 'createCrmCompany')

    const result = await registerCompany({ session, kind: 'customer', data: details, target: 'crm' })
    expect(result).toMatchObject({ ok: false })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('linkExistingCrmRecord', () => {
  it('links a new local company to the chosen record', async () => {
    const result = await linkExistingCrmRecord({ session, kind: 'customer', data: details, crmRecordId: 'crm-7', crmObjectType: 1 })
    expect(result).toMatchObject({ ok: true, outcome: 'created_and_linked' })
    if (!result.ok || result.outcome !== 'created_and_linked') return
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id))
    expect(row.crmRecordId).toBe('crm-7')
  })

  it('returns the company we already hold instead of making a second one', async () => {
    const [existing] = await db
      .insert(schema.companies)
      .values({ organizationId: orgId, kind: 'customer', name: 'כבר מסונכרן', crmRecordId: 'crm-9', crmObjectType: 1, source: 'crm' })
      .returning({ id: schema.companies.id })

    const result = await linkExistingCrmRecord({ session, kind: 'customer', data: details, crmRecordId: 'crm-9', crmObjectType: 1 })
    expect(result).toMatchObject({ ok: true, id: existing.id })
    expect(await db.select().from(schema.companies).where(eq(schema.companies.organizationId, orgId))).toHaveLength(1)
  })
})
