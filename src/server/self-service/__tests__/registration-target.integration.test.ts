import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import type { RegistrationValues } from '@/lib/self-service-registration'
import { resolveSupplier } from '../onboarding'

/**
 * Where registrants go is the campaign's decision, enforced here:
 *
 * - XTRA Sign never looks at the CRM mirror — not even when a mirrored
 *   company carries the same tax id or phone — and never writes to the CRM.
 * - A second registration with the same details reuses the local company.
 * - CRM links only on one exact tax-id match and changes nothing on the
 *   linked row; no match or several means a local row flagged for a person.
 */

// The CRM write path must never be reached from a registration.
const crmWrites = vi.hoisted(() => ({ createCrmCompany: vi.fn(), linkLocalToCrm: vi.fn() }))
vi.mock('@/server/crm/company-registration', async (importOriginal) => ({ ...(await importOriginal<object>()), createCrmCompany: crmWrites.createCrmCompany }))
vi.mock('@/server/companies/registration', async (importOriginal) => ({ ...(await importOriginal<object>()), linkLocalToCrm: crmWrites.linkLocalToCrm }))

const db = getDb()
let session: StaffSession
let orgId: string
let seq = 0

const values = (over: Partial<RegistrationValues> = {}): RegistrationValues => ({
  businessName: `עסק ${++seq}`,
  taxId: '515000001',
  phone: '+972501110001',
  email: `owner${seq}@example.co.il`,
  signatoryName: 'ישראל ישראלי',
  signatoryRole: 'מנכ"ל',
  ...over,
})

async function mirroredCompany(taxId: string, phone: string) {
  const [row] = await db
    .insert(schema.companies)
    .values({ organizationId: orgId, kind: 'supplier', name: `CRM ${taxId} ${++seq}`, taxId, contactName: 'איש CRM', contactPhone: phone, contactEmail: `crm${seq}@example.co.il`, source: 'crm', crmRecordId: `crm-${taxId}-${seq}`, crmObjectType: 1000 })
    .returning({ id: schema.companies.id })
  return row.id
}

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Target ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id, email: schema.users.email })
  session = { userId: u.id, organizationId: orgId, email: u.email, name: 'Owner', isAdmin: true }
})

describe('registration target', () => {
  it('XTRA Sign ignores a mirrored company with the same tax id and phone, and creates a local one', async () => {
    const crmId = await mirroredCompany('515000001', '+972501110001')
    const data = values()
    const resolved = await resolveSupplier(session, data, 'xtra_sign')
    expect(resolved.id).not.toBe(crmId)
    expect(resolved.needsLinking).toBeUndefined()
    const [local] = await db.select().from(schema.companies).where(eq(schema.companies.id, resolved.id))
    expect(local.crmRecordId).toBeNull()
    expect(local.source).toBe('xtra')
    expect(local.name).toBe(data.businessName)
  })

  it('a second registration with the same details reuses the local company', async () => {
    const data = values({ taxId: '515000002', phone: '+972501110002' })
    const first = await resolveSupplier(session, data, 'xtra_sign')
    const again = await resolveSupplier(session, { ...data, businessName: 'שם אחר' }, 'xtra_sign')
    expect(again.id).toBe(first.id)
    expect(again.matchedOn).toBe('taxId')
  })

  it('CRM links on exactly one tax-id match and leaves the mirrored row untouched', async () => {
    const crmId = await mirroredCompany('515000003', '+972501110003')
    const [before] = await db.select().from(schema.companies).where(eq(schema.companies.id, crmId))
    const resolved = await resolveSupplier(session, values({ taxId: '515000003', phone: '+972509999999', email: 'other@example.co.il' }), 'crm')
    expect(resolved.id).toBe(crmId)
    expect(resolved.needsLinking).toBeUndefined()
    const [after] = await db.select().from(schema.companies).where(eq(schema.companies.id, crmId))
    expect(after).toEqual(before)
  })

  it('CRM with no tax-id match keeps the registration on a local row flagged for linking — not on a phone match', async () => {
    const crmId = await mirroredCompany('515000004', '+972501110004')
    const resolved = await resolveSupplier(session, values({ taxId: '515000999', phone: '+972501110004' }), 'crm')
    expect(resolved.id).not.toBe(crmId)
    expect(resolved.needsLinking).toBe(true)
    const [local] = await db.select().from(schema.companies).where(eq(schema.companies.id, resolved.id))
    expect(local.crmRecordId).toBeNull()
  })

  it('CRM with several tax-id matches does not guess', async () => {
    const a = await mirroredCompany('515000005', '+972501110005')
    const b = await mirroredCompany('515000005', '+972501110006')
    const resolved = await resolveSupplier(session, values({ taxId: '515000005' }), 'crm')
    expect([a, b]).not.toContain(resolved.id)
    expect(resolved.needsLinking).toBe(true)
  })

  it('never writes to the CRM from a registration, in either mode', () => {
    expect(crmWrites.createCrmCompany).not.toHaveBeenCalled()
    expect(crmWrites.linkLocalToCrm).not.toHaveBeenCalled()
  })
})
