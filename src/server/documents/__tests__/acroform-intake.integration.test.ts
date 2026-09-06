import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { sha256 } from '../file-validation'
import { processDocumentVersion } from '../process-document'
import { loadFields } from '../save-fields'
import { uploadDocument } from '../upload-document'

/**
 * Uploading a fillable PDF: the source stays as uploaded, the rendered copy is
 * the flattened form, and the version starts with the form's boxes as fields.
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')
const db = getDb()

let session: StaffSession
let companyId: string

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Forms ${suffix}` }).returning({ id: schema.organizations.id })
  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: org.id,
      email: `forms-${suffix}@xtra.test`,
      name: 'Owner',
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin: true,
    })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: org.id, email: `forms-${suffix}@xtra.test`, name: 'Owner', isAdmin: true }
  const [company] = await db
    .insert(schema.companies)
    .values({ organizationId: org.id, kind: 'supplier', name: 'ספק טפסים' })
    .returning({ id: schema.companies.id })
  companyId = company.id
})

describe('processDocumentVersion with a fillable PDF', () => {
  it('flattens into the rendered copy and seeds the fields', async () => {
    const uploaded = await uploadDocument({
      session,
      buffer: FIXTURE,
      filename: 'הסכם.pdf',
      companyId,
    })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return

    const processed = await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: session.organizationId,
      versionId: uploaded.versionId,
      actor: session.email,
    })
    expect(processed).toEqual({ ok: true, pageCount: 1 })

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, uploaded.versionId))
    expect(version.renderedFileKey).not.toBe(version.sourceFileKey)
    expect(version.renderedFileKey).toMatch(/\/rendered\//)

    const storage = getStorage()
    const source = await storage.get(version.sourceFileKey!)
    expect(sha256(source)).toBe(uploaded.sha256)

    const rendered = await storage.get(version.renderedFileKey!)
    expect(version.renderedHash).toBe(sha256(rendered))
    const flat = await PDFDocument.load(rendered)
    expect(flat.getForm().getFields()).toHaveLength(0)

    const fields = await loadFields(uploaded.versionId)
    expect(fields).toHaveLength(8)
    expect(fields.map((f) => f.variableKey).sort()).toEqual(
      [
        'authorized_signatory',
        'business_name',
        'company_number',
        'contact_email',
        'contact_phone',
        'signatory_role',
        'signature_date',
        'typed_signature',
      ].sort(),
    )

    // A second run keeps the layout: no duplicate fields, one geometry per page.
    const again = await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: session.organizationId,
      versionId: uploaded.versionId,
      actor: session.email,
    })
    expect(again.ok).toBe(true)
    expect(await loadFields(uploaded.versionId)).toHaveLength(8)
    const pages = await db
      .select()
      .from(schema.documentPages)
      .where(eq(schema.documentPages.agreementVersionId, uploaded.versionId))
    expect(pages).toHaveLength(1)
  })
})
