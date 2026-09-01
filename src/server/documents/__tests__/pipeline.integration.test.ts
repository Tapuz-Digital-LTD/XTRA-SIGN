import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { sha256 } from '../file-validation'
import { processDocumentVersion } from '../process-document'
import { uploadDocument } from '../upload-document'

/**
 * Upload through conversion to stored page images, against the real Postgres,
 * MinIO and converter container.
 */

const db = getDb()

let orgId: string
let session: StaffSession
const createdAgreements: string[] = []

beforeAll(async () => {

  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Pipeline ${suffix}` })
    .returning({ id: schema.organizations.id })
  orgId = org.id

  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: orgId,
      email: `pipeline-${suffix}@xtra.test`,
      name: 'Pipeline',
      passwordHash: 'x',
      isAdmin: true,
    })
    .returning({ id: schema.users.id })

  session = {
    userId: user.id,
    organizationId: orgId,
    email: `pipeline-${suffix}@xtra.test`,
    name: 'Pipeline',
    isAdmin: true,
  }
}, 180_000)

afterAll(async () => {
  for (const id of createdAgreements) {
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, id))
    await db.update(schema.agreements).set({ currentVersionId: null }).where(eq(schema.agreements.id, id))

    // Page geometry references the version, so it goes first. PGlite enforces
    // the same foreign keys production does, which is the point of using it.
    const versions = await db
      .select({ id: schema.agreementVersions.id })
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.agreementId, id))
    for (const v of versions) {
      await db.delete(schema.documentPages).where(eq(schema.documentPages.agreementVersionId, v.id))
    }

    await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, id))
    await db.delete(schema.agreements).where(eq(schema.agreements.id, id))
  }
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})




describe('PDF end to end', () => {
  it('uses the uploaded PDF as its own render and records real page geometry', async () => {
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from(
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
          '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n' +
          '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
          'trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n',
      ),
    ])

    const uploaded = await uploadDocument({ session, buffer: pdf, filename: 'מסמך.pdf' })
    if (!uploaded.ok) throw new Error('upload rejected')
    createdAgreements.push(uploaded.agreementId)

    const processed = await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: orgId,
      versionId: uploaded.versionId,
      actor: session.email,
    })
    expect(processed.ok).toBe(true)

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, uploaded.versionId))

    // There is nothing to convert: the uploaded PDF is the document that gets
    // signed, so one object serves both roles and carries one hash.
    expect(version.renderedFileKey).toBe(version.sourceFileKey)
    expect(version.renderedHash).toBe(sha256(pdf))
    expect(version.pageCount).toBe(1)

    // The geometry that every field position depends on, read straight out of
    // the PDF rather than rasterised.
    const pages = await db
      .select()
      .from(schema.documentPages)
      .where(eq(schema.documentPages.agreementVersionId, uploaded.versionId))

    expect(pages).toHaveLength(1)
    expect(pages[0].widthPt).toBeCloseTo(595, 0)
    expect(pages[0].heightPt).toBeCloseTo(842, 0)
  }, 180_000)
})

describe('a failed conversion', () => {
  it('keeps the agreement and the original, and reports in Hebrew', async () => {
    const brokenZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml'),
      Buffer.alloc(512),
    ])

    const uploaded = await uploadDocument({
      session,
      buffer: brokenZip,
      filename: 'שבור.docx',
    })
    if (!uploaded.ok) throw new Error('upload rejected before processing')
    createdAgreements.push(uploaded.agreementId)

    const processed = await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: orgId,
      versionId: uploaded.versionId,
      actor: session.email,
    })

    expect(processed.ok).toBe(false)
    if (!processed.ok) expect(processed.message).toMatch(/[\u0590-\u05ff]/)

    // The user can still download what they gave us.
    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, uploaded.versionId))
    expect(version.sourceFileKey).toBeTruthy()
    expect(await getStorage().exists(version.sourceFileKey!)).toBe(true)

    // The failure is on the record rather than silently swallowed.
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.agreementId, uploaded.agreementId))
    expect(events.map((e) => e.type)).toContain('document_generation_failed')
  }, 180_000)
})
