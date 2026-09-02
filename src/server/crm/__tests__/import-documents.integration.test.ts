import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { FireberryProvider } from '../fireberry'
import { importCrmDocuments, listCrmDocuments } from '../import-documents'

/** Against the real Postgres, with Fireberry's file API mocked. */

const db = getDb()
let orgId: string
let companyId: string
let session: StaffSession
let suffix: string
let n = 0

// A minimal but genuine PDF, so the real magic-byte validation passes.
async function pdfBytes(): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([595.28, 841.89])
  return Buffer.from(await doc.save())
}

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  process.env.FIREBERRY_API_TOKEN = 'test-token'
  const [org] = await db.insert(schema.organizations).values({ name: `I ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `imp-${suffix}@x.test`, name: 'a', phone: `+9725${String(++n).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: `imp-${suffix}@x.test`, name: 'a', isAdmin: true }
  const [c] = await db
    .insert(schema.companies)
    .values({ organizationId: orgId, kind: 'supplier', name: 'ספק CRM', crmRecordId: `rec-${suffix}`, crmObjectType: 1000, source: 'crm' })
    .returning({ id: schema.companies.id })
  companyId = c.id
})

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  const ags = await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  for (const a of ags) {
    const vs = await db.select({ id: schema.agreementVersions.id }).from(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
    for (const v of vs) await db.delete(schema.documentPages).where(eq(schema.documentPages.agreementVersionId, v.id))
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
    await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
  }
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
  delete process.env.FIREBERRY_API_TOKEN
})

function mockFiles(files: { id: string; name: string }[], bytes: Buffer) {
  vi.spyOn(FireberryProvider.prototype, 'listRecordFiles').mockResolvedValue(
    files.map((f) => ({ id: f.id, name: f.name, url: `https://c.fireberry.com/file/x/${f.name}`, sizeMb: 0.1 })),
  )
  vi.spyOn(FireberryProvider.prototype, 'downloadFile').mockResolvedValue(bytes)
}

describe('CRM document import', () => {
  it('lists files, marks PDFs importable and other types not', async () => {
    mockFiles([{ id: `f1-${suffix}`, name: 'הסכם.pdf' }, { id: `f2-${suffix}`, name: 'מייל.msg' }], await pdfBytes())
    const result = await listCrmDocuments({ session, companyId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pdf = result.files.find((f) => f.name === 'הסכם.pdf')!
    const msg = result.files.find((f) => f.name === 'מייל.msg')!
    expect(pdf.isPdf).toBe(true)
    expect(pdf.alreadyImported).toBe(false)
    expect(msg.isPdf).toBe(false)
  })

  it('imports only the chosen PDF, and never the same CRM file twice', async () => {
    const fileId = `dedup-${suffix}`
    mockFiles([{ id: fileId, name: 'חוזה.pdf' }], await pdfBytes())

    const first = await importCrmDocuments({ session, companyId, fileIds: [fileId] })
    expect(first).toMatchObject({ ok: true, imported: 1, skipped: 0 })

    // It is filed under the company and carries the CRM file id.
    const [doc] = await db.select().from(schema.agreements).where(eq(schema.agreements.crmDocumentId, fileId))
    expect(doc.companyId).toBe(companyId)
    expect(doc.status).toBe('draft')

    // A second import of the same CRM file is skipped, not duplicated.
    const second = await importCrmDocuments({ session, companyId, fileIds: [fileId] })
    expect(second).toMatchObject({ ok: true, imported: 0, skipped: 1 })
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.crmDocumentId, fileId))).toHaveLength(1)

    // And the listing now reports it as already imported.
    const listed = await listCrmDocuments({ session, companyId })
    if (!listed.ok) return
    expect(listed.files[0].alreadyImported).toBe(true)
    expect(listed.files[0].documentId).toBe(doc.id)
  })

  it('REFUSES a non-PDF with a clear reason, importing nothing', async () => {
    const fileId = `msg-${suffix}`
    mockFiles([{ id: fileId, name: 'תכתובת.msg' }], await pdfBytes())
    const result = await importCrmDocuments({ session, companyId, fileIds: [fileId] })
    expect(result).toMatchObject({ ok: true, imported: 0 })
    if (!result.ok) return
    expect(result.failed[0].reason).toContain('PDF')
  })

  it('REFUSES a company that is not linked to the CRM', async () => {
    const [local] = await db
      .insert(schema.companies)
      .values({ organizationId: orgId, kind: 'supplier', name: 'ספק מקומי' })
      .returning({ id: schema.companies.id })
    const result = await listCrmDocuments({ session, companyId: local.id })
    expect(result).toMatchObject({ ok: false })
  })
})
