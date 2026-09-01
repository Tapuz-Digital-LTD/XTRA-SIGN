import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess, authorizeVersionFileAccess } from '../authorization'
import { sha256 } from '../file-validation'
import { uploadDocument } from '../upload-document'

/**
 * End-to-end against the real Postgres and MinIO from docker-compose.
 *
 * The subject here is the tenant boundary. Mocking the database would let a
 * broken WHERE clause pass, which is the whole thing being tested.
 */

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('supplier agreement body')])

const db = getDb()

let orgA: string
let orgB: string
let alice: StaffSession
let bob: StaffSession
let carol: StaffSession
let adminA: StaffSession
let aliceAgreementId: string
const storageKeys: string[] = []

async function makeOrg(name: string) {
  const [row] = await db.insert(schema.organizations).values({ name }).returning({ id: schema.organizations.id })
  return row.id
}

async function makeUser(
  organizationId: string,
  email: string,
  isAdmin = false,
): Promise<StaffSession> {
  const [row] = await db
    .insert(schema.users)
    .values({ organizationId, email, name: email, passwordHash: 'x', isAdmin })
    .returning({ id: schema.users.id })
  return { userId: row.id, organizationId, email, name: email, isAdmin }
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  orgA = await makeOrg(`Org A ${suffix}`)
  orgB = await makeOrg(`Org B ${suffix}`)

  alice = await makeUser(orgA, `alice-${suffix}@xtra.test`)
  carol = await makeUser(orgA, `carol-${suffix}@xtra.test`)
  adminA = await makeUser(orgA, `admin-${suffix}@xtra.test`, true)
  bob = await makeUser(orgB, `bob-${suffix}@xtra.test`)

  const result = await uploadDocument({
    session: alice,
    buffer: PDF,
    filename: 'הסכם ספק.pdf',
  })
  if (!result.ok) throw new Error(`upload failed: ${result.message}`)
  aliceAgreementId = result.agreementId
})

afterAll(async () => {
  // Leave the dev database tidy. Order matters: every child row must go before
  // the row it references, and the agreement's own currentVersionId pointer has
  // to be cleared before its versions can be deleted.
  for (const org of [orgA, orgB]) {
    const agreements = await db
      .select({ id: schema.agreements.id })
      .from(schema.agreements)
      .where(eq(schema.agreements.organizationId, org))

    for (const a of agreements) {
      await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id))
      await db
        .update(schema.agreements)
        .set({ currentVersionId: null })
        .where(eq(schema.agreements.id, a.id))
      await db
        .delete(schema.agreementVersions)
        .where(eq(schema.agreementVersions.agreementId, a.id))
      await db.delete(schema.agreements).where(eq(schema.agreements.id, a.id))
    }

    await db.delete(schema.users).where(eq(schema.users.organizationId, org))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org))
  }

  // The objects written during the run are dev-bucket litter otherwise.
  const { getStorage } = await import('@/server/storage/blob')
  for (const key of storageKeys) {
    await getStorage().delete(key).catch(() => {})
  }
})

describe('uploadDocument', () => {
  it('stores the original bytes unchanged and records their SHA-256', async () => {
    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.agreementId, aliceAgreementId))

    expect(version.sourceFileKey).toBeTruthy()
    expect(version.renderedHash).toBe(sha256(PDF))
    storageKeys.push(version.sourceFileKey!)

    // The stored object must be byte-identical to what was uploaded.
    const { getStorage } = await import('@/server/storage/blob')
    const stored = await getStorage().get(version.sourceFileKey!)
    expect(sha256(stored)).toBe(sha256(PDF))
  })

  it('keys the object under the uploader organization', async () => {
    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.agreementId, aliceAgreementId))

    expect(version.sourceFileKey!.startsWith(`org/${orgA}/`)).toBe(true)
  })

  it('writes a created audit event without leaking content', async () => {
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.agreementId, aliceAgreementId))

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('created')

    const meta = JSON.stringify(events[0].metadata)
    expect(meta).toContain(sha256(PDF))
    expect(meta).not.toContain('supplier agreement body')
  })

  it('rejects a disguised file before anything is stored', async () => {
    const before = await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgA))

    const result = await uploadDocument({
      session: alice,
      buffer: Buffer.from('<html><script>alert(1)</script></html>'),
      filename: 'contract.pdf',
    })

    expect(result.ok).toBe(false)

    const after = await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, orgA))
    expect(after.length).toBe(before.length)
  })
})

describe('authorizeAgreementAccess — the tenant boundary', () => {
  it('lets the owner in', async () => {
    const agreement = await authorizeAgreementAccess(alice, aliceAgreementId)
    expect(agreement.id).toBe(aliceAgreementId)
  })

  it('REFUSES a user from another organization holding a valid id', async () => {
    // The exact IDOR: Bob knows Alice's agreement id and asks for it directly.
    await expect(authorizeAgreementAccess(bob, aliceAgreementId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('refuses a different non-admin user inside the same organization', async () => {
    await expect(authorizeAgreementAccess(carol, aliceAgreementId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lets an admin of the same organization in', async () => {
    const agreement = await authorizeAgreementAccess(adminA, aliceAgreementId)
    expect(agreement.id).toBe(aliceAgreementId)
  })

  it('refuses an admin of a DIFFERENT organization', async () => {
    // Admin is scoped to its own tenant, never global.
    const adminB = await makeUser(orgB, `adminb-${crypto.randomUUID().slice(0, 8)}@xtra.test`, true)
    await expect(authorizeAgreementAccess(adminB, aliceAgreementId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('rejects a malformed id without reaching the database', async () => {
    for (const bad of ["' OR 1=1 --", '../../etc/passwd', 'not-a-uuid', '']) {
      await expect(authorizeAgreementAccess(alice, bad)).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  it('gives the same answer for a nonexistent id as for a forbidden one', async () => {
    // Otherwise the endpoint confirms which ids exist.
    const missing = authorizeAgreementAccess(alice, crypto.randomUUID())
    await expect(missing).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('authorizeVersionFileAccess', () => {
  it('resolves a key for the owner', async () => {
    const { key } = await authorizeVersionFileAccess(alice, aliceAgreementId, 'source')
    expect(key.startsWith(`org/${orgA}/`)).toBe(true)
  })

  it('refuses to hand a key to another tenant', async () => {
    await expect(
      authorizeVersionFileAccess(bob, aliceAgreementId, 'source'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a file that does not exist yet rather than returning null', async () => {
    // No signing has happened, so there is no signed PDF to hand out.
    await expect(
      authorizeVersionFileAccess(alice, aliceAgreementId, 'signed'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
