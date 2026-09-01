import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/s3'
import { sha256 } from '../file-validation'
import { pageImageKey, processDocumentVersion } from '../process-document'
import { uploadDocument } from '../upload-document'
import { FIXTURES, buildFixtures } from './fixtures'

/**
 * Upload through conversion to stored page images, against the real Postgres,
 * MinIO and converter container.
 */

const db = getDb()

let orgId: string
let session: StaffSession
const createdAgreements: string[] = []

beforeAll(async () => {
  buildFixtures()

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
    await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, id))
    await db.delete(schema.agreements).where(eq(schema.agreements.id, id))
  }
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

async function uploadAndProcess(path: string, filename: string) {
  const buffer = readFileSync(path)
  const uploaded = await uploadDocument({ session, buffer, filename })
  if (!uploaded.ok) throw new Error(`upload rejected: ${uploaded.message}`)
  createdAgreements.push(uploaded.agreementId)

  const processed = await processDocumentVersion({
    agreementId: uploaded.agreementId,
    organizationId: orgId,
    versionId: uploaded.versionId,
    actor: session.email,
  })

  return { uploaded, processed }
}

describe('DOCX end to end', () => {
  it('uploads, converts, and stores one page image per page', async () => {
    const { uploaded, processed } = await uploadAndProcess(FIXTURES.docx, 'הסכם ספק.docx')

    expect(processed).toMatchObject({ ok: true, pageCount: 1 })

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, uploaded.versionId))

    // The rendered PDF is a separate object from the source, with its own hash:
    // the source hash says nothing about what will actually be signed.
    expect(version.renderedFileKey).toBeTruthy()
    expect(version.renderedFileKey).not.toBe(version.sourceFileKey)
    expect(version.renderedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(version.pageCount).toBe(1)

    const storage = getStorage()

    const rendered = await storage.get(version.renderedFileKey!)
    expect(rendered.subarray(0, 5).toString()).toBe('%PDF-')
    // The recorded hash must be the hash of what is actually stored.
    expect(sha256(rendered)).toBe(version.renderedHash)

    const page = await storage.get(
      pageImageKey(
        { organizationId: orgId, agreementId: uploaded.agreementId, versionId: version.id },
        1,
      ),
    )
    expect(page.subarray(1, 4).toString()).toBe('PNG')

    // The original is kept untouched alongside the render.
    const source = await storage.get(version.sourceFileKey!)
    expect(sha256(source)).toBe(sha256(readFileSync(FIXTURES.docx)))
  }, 180_000)
})

describe('legacy DOC end to end', () => {
  it('uploads, converts and renders a binary .doc', async () => {
    const { uploaded, processed } = await uploadAndProcess(FIXTURES.doc, 'הסכם ספק ישן.doc')

    expect(processed).toMatchObject({ ok: true, pageCount: 1 })

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, uploaded.versionId))

    const page = await getStorage().get(
      pageImageKey(
        { organizationId: orgId, agreementId: uploaded.agreementId, versionId: version.id },
        1,
      ),
    )
    expect(page.subarray(1, 4).toString()).toBe('PNG')
    expect(page.length).toBeGreaterThan(5_000)
  }, 180_000)
})

describe('PDF end to end', () => {
  it('keeps a PDF as its own render rather than converting it again', async () => {
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

    // Re-rendering a PDF through LibreOffice would change its bytes for nothing.
    expect(version.renderedFileKey).toBe(version.sourceFileKey)
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
