import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { cancelAgreement, createNewVersion, duplicateAgreement, versionChain } from '../lifecycle'

/** Against the real Postgres and the in-memory storage. */

const db = getDb()
let orgId: string
let session: StaffSession
let suffix: string
let seq = 0

async function seedDocument(status: 'draft' | 'sent'): Promise<string> {
  const id = crypto.randomUUID()
  const sourceKey = `org/${orgId}/agreements/${id}/source/${crypto.randomUUID()}.pdf`
  await getStorage().put(sourceKey, Buffer.from('%PDF-1.7 test'), 'application/pdf')

  await db.insert(schema.agreements).values({ id, organizationId: orgId, title: `doc ${++seq}`, status, ownerId: session.userId })
  const [v] = await db
    .insert(schema.agreementVersions)
    .values({ agreementId: id, versionNumber: 1, sourceFileKey: sourceKey, renderedFileKey: sourceKey, renderedHash: 'h', pageCount: 1 })
    .returning({ id: schema.agreementVersions.id })
  await db.update(schema.agreements).set({ currentVersionId: v.id }).where(eq(schema.agreements.id, id))
  await db.insert(schema.documentPages).values({ agreementVersionId: v.id, pageNumber: 1, widthPt: 595, heightPt: 842 })
  await db.insert(schema.fields).values([
    { agreementVersionId: v.id, type: 'signature', label: 'חתימה', ownedBy: 'signer', required: true, page: 1, x: 0.5, y: 0.8, width: 0.3, height: 0.05, autoFill: false },
    { agreementVersionId: v.id, type: 'text', label: 'שם', ownedBy: 'sender', required: true, page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04, value: 'קבוע', autoFill: false },
  ])
  await db.insert(schema.recipients).values({ agreementId: id, name: 'נמען', phone: '+972500000000' })
  return id
}

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `L ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `life-${suffix}@x.test`, name: 'a', phone: `+9725${String(seq).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: `life-${suffix}@x.test`, name: 'a', isAdmin: true }
})

afterAll(async () => {
  const ags = await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  for (const a of ags) {
    const vs = await db.select({ id: schema.agreementVersions.id }).from(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
    for (const v of vs) {
      await db.delete(schema.fields).where(eq(schema.fields.agreementVersionId, v.id))
      await db.delete(schema.documentPages).where(eq(schema.documentPages.agreementVersionId, v.id))
    }
    const rs = await db.select({ id: schema.recipients.id }).from(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
    for (const r of rs) await db.delete(schema.signingTokens).where(eq(schema.signingTokens.recipientId, r.id))
    await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, a.id))
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
    await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, a.id))
  }
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

describe('document lifecycle', () => {
  it('cancels a sent document and revokes its signing token', async () => {
    const id = await seedDocument('sent')
    const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, id))
    await db.insert(schema.signingTokens).values({ recipientId: recipient.id, tokenHash: `hash-${suffix}-${seq}`, expiresAt: new Date(Date.now() + 1e7) })

    expect(await cancelAgreement({ session, agreementId: id })).toMatchObject({ ok: true })

    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id))
    expect(a.status).toBe('canceled')
    const tokens = await db.select().from(schema.signingTokens).where(eq(schema.signingTokens.recipientId, recipient.id))
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true)
  })

  it('REFUSES to cancel a signed document', async () => {
    const id = await seedDocument('sent')
    await db.update(schema.agreements).set({ status: 'signed' }).where(eq(schema.agreements.id, id))
    expect(await cancelAgreement({ session, agreementId: id })).toMatchObject({ ok: false })
  })

  it('duplicates into an independent draft with copied fields and its own files', async () => {
    const id = await seedDocument('sent')
    const [srcVersion] = await db.select().from(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, id))

    const result = await duplicateAgreement({ session, agreementId: id })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    const [copy] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.id))
    expect(copy.status).toBe('draft')
    expect(copy.title).toContain('עותק')
    expect(copy.supersedesId).toBeNull()

    const [copyVersion] = await db.select().from(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, result.id))
    // Its own storage object, not the source's.
    expect(copyVersion.sourceFileKey).not.toBe(srcVersion.sourceFileKey)
    expect(copyVersion.sourceFileKey).toContain(result.id)

    const copiedFields = await db.select().from(schema.fields).where(eq(schema.fields.agreementVersionId, copyVersion.id))
    expect(copiedFields).toHaveLength(2)
    // Our fixed value carried over; the signer's stays empty.
    expect(copiedFields.find((f) => f.ownedBy === 'sender')?.value).toBe('קבוע')
  })

  it('creates a new version that supersedes the original and leaves it intact', async () => {
    const id = await seedDocument('sent')
    await db.update(schema.agreements).set({ status: 'signed' }).where(eq(schema.agreements.id, id))

    const result = await createNewVersion({ session, agreementId: id })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    const [next] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.id))
    expect(next.status).toBe('draft')
    expect(next.supersedesId).toBe(id)

    // Original untouched.
    const [orig] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id))
    expect(orig.status).toBe('signed')

    // The chain links both ways.
    const chainOfNew = await versionChain(session, result.id)
    expect(chainOfNew.predecessor?.id).toBe(id)
    const chainOfOrig = await versionChain(session, id)
    expect(chainOfOrig.successors.map((s) => s.id)).toContain(result.id)
  })
})
