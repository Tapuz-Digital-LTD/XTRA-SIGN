import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { setDocumentCompany } from '../company-link'
import { uploadDocument } from '../upload-document'

/** A real one-page PDF, enough to pass validation. */
const PDF = Buffer.from(
  '255044462d312e340a312030206f626a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e656e646f626a0a322030206f626a3c3c2f54797065' +
    '2f50616765732f4b6964735b33203020525d2f436f756e7420313e3e656e646f626a0a332030206f626a3c3c2f547970652f506167652f506172656e742032203020' +
    '522f4d65646961426f785b30203020353935203834325d3e3e656e646f626a0a747261696c65723c3c2f526f6f742031203020523e3e0a2525454f46',
  'hex',
)

const db = getDb()
let orgA: string
let orgB: string
let alice: StaffSession
let companyA: string
let companyA2: string
let companyB: string
let agreementId: string

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const orgs = await db
    .insert(schema.organizations)
    .values([{ name: `CL-A ${suffix}` }, { name: `CL-B ${suffix}` }])
    .returning({ id: schema.organizations.id })
  ;[orgA, orgB] = [orgs[0].id, orgs[1].id]

  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgA, email: `cl-${suffix}@x.test`, name: 'a', phone: `+9723${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  alice = { userId: user.id, organizationId: orgA, email: `cl-${suffix}@x.test`, name: 'a', isAdmin: true }

  const companies = await db
    .insert(schema.companies)
    .values([
      { organizationId: orgA, kind: 'supplier', name: `ספק ${suffix}` },
      { organizationId: orgA, kind: 'customer', name: `לקוח ${suffix}` },
      { organizationId: orgB, kind: 'supplier', name: `זר ${suffix}` },
    ])
    .returning({ id: schema.companies.id })
  ;[companyA, companyA2, companyB] = companies.map((c) => c.id)

  const uploaded = await uploadDocument({ session: alice, buffer: PDF, filename: 'מסמך.pdf', companyId: companyA })
  if (!uploaded.ok) throw new Error(uploaded.message)
  agreementId = uploaded.agreementId
})

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    const ags = await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, org))
    for (const a of ags) {
      await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
      await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
      await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
    }
    await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, org))
    await db.delete(schema.companies).where(eq(schema.companies.organizationId, org))
    await db.delete(schema.users).where(eq(schema.users.organizationId, org))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org))
  }
})

describe('creation requires a company', () => {
  it('refuses an upload without one, before anything is stored', async () => {
    const result = await uploadDocument({ session: alice, buffer: PDF, filename: 'בלי.pdf' })
    expect(result).toMatchObject({ ok: false, code: 'missing_company' })
  })

  it('records how the document came to exist', async () => {
    const [row] = await db
      .select({ sourceKind: schema.agreements.sourceKind, companyId: schema.agreements.companyId })
      .from(schema.agreements)
      .where(eq(schema.agreements.id, agreementId))
    expect(row).toEqual({ sourceKind: 'uploaded', companyId: companyA })
  })
})

describe('setDocumentCompany', () => {
  it('moves the document to another of our companies and writes an audit row', async () => {
    const result = await setDocumentCompany({ session: alice, agreementId, companyId: companyA2 })
    expect(result).toMatchObject({ ok: true })

    const [row] = await db.select({ companyId: schema.agreements.companyId }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(row.companyId).toBe(companyA2)

    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, agreementId))
    expect(audits.some((a) => a.type === 'company_linked')).toBe(true)
  })

  it("refuses another organization's company — same answer as not-found", async () => {
    const result = await setDocumentCompany({ session: alice, agreementId, companyId: companyB })
    expect(result).toMatchObject({ ok: false })

    const [row] = await db.select({ companyId: schema.agreements.companyId }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(row.companyId).toBe(companyA2) // unchanged
  })

  it('detaches with null', async () => {
    const result = await setDocumentCompany({ session: alice, agreementId, companyId: null })
    expect(result).toMatchObject({ ok: true })
    const [row] = await db.select({ companyId: schema.agreements.companyId }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(row.companyId).toBeNull()
  })
})

describe('recipient seeding', () => {
  it('starts the recipient from the company contact, already saved', async () => {
    const [company] = await db
      .insert(schema.companies)
      .values({
        organizationId: orgA,
        kind: 'customer',
        name: 'מקדונלדס בדיקה',
        contactName: 'ישראל ישראלי',
        contactPhone: '+972501112233',
        contactEmail: 'israel@example.com',
      })
      .returning({ id: schema.companies.id })

    const uploaded = await uploadDocument({ session: alice, buffer: PDF, filename: 'עם איש קשר.pdf', companyId: company.id })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return

    const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, uploaded.agreementId))
    expect(recipient).toMatchObject({
      name: 'ישראל ישראלי',
      company: 'מקדונלדס בדיקה',
      phone: '+972501112233',
      email: 'israel@example.com',
    })
  })

  it('leaves the recipient empty when the company has no contact name', async () => {
    const [company] = await db
      .insert(schema.companies)
      .values({ organizationId: orgA, kind: 'supplier', name: 'ספק בלי איש קשר' })
      .returning({ id: schema.companies.id })

    const uploaded = await uploadDocument({ session: alice, buffer: PDF, filename: 'בלי.pdf', companyId: company.id })
    if (!uploaded.ok) throw new Error(uploaded.message)

    const rows = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, uploaded.agreementId))
    expect(rows).toHaveLength(0)
  })
})
