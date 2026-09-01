import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { ForbiddenError } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { loadFields, saveFields, saveRecipient } from '../save-fields'

/** Against the real Postgres. */

const db = getDb()

let orgId: string
let otherOrgId: string
let session: StaffSession
let intruder: StaffSession
let agreementId: string
let versionId: string

const field = (over: Record<string, unknown> = {}) => ({
  type: 'signature',
  label: 'חתימה',
  ownedBy: 'signer',
  required: true,
  page: 1,
  x: 0.72,
  y: 0.9,
  width: 0.28,
  height: 0.06,
  ...over,
})

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)

  const [org] = await db.insert(schema.organizations).values({ name: `F ${suffix}` }).returning({ id: schema.organizations.id })
  const [other] = await db.insert(schema.organizations).values({ name: `O ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  otherOrgId = other.id

  const mkUser = async (organizationId: string, email: string) => {
    const [u] = await db
      .insert(schema.users)
      .values({ organizationId, email, name: email, passwordHash: 'x', isAdmin: true })
      .returning({ id: schema.users.id })
    return { userId: u.id, organizationId, email, name: email, isAdmin: true } as StaffSession
  }

  session = await mkUser(orgId, `owner-${suffix}@xtra.test`)
  intruder = await mkUser(otherOrgId, `intruder-${suffix}@xtra.test`)

  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, title: 'הסכם', status: 'draft', ownerId: session.userId })
    .returning({ id: schema.agreements.id })
  agreementId = agreement.id

  const [version] = await db
    .insert(schema.agreementVersions)
    .values({ agreementId, versionNumber: 1, pageCount: 3 })
    .returning({ id: schema.agreementVersions.id })
  versionId = version.id

  await db
    .update(schema.agreements)
    .set({ currentVersionId: versionId })
    .where(eq(schema.agreements.id, agreementId))
})

afterAll(async () => {
  await db.delete(schema.fields).where(eq(schema.fields.agreementVersionId, versionId))
  await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, agreementId))
  await db.update(schema.agreements).set({ currentVersionId: null }).where(eq(schema.agreements.id, agreementId))
  await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, agreementId))
  await db.delete(schema.agreements).where(eq(schema.agreements.id, agreementId))
  for (const id of [orgId, otherOrgId]) {
    await db.delete(schema.users).where(eq(schema.users.organizationId, id))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, id))
  }
})

describe('saveFields', () => {
  it('stores fractions exactly as given', async () => {
    const result = await saveFields({ session, agreementId, fields: [field()] })
    expect(result).toMatchObject({ ok: true, count: 1 })

    const [saved] = await loadFields(versionId)
    expect(saved.x).toBeCloseTo(0.72, 6)
    expect(saved.y).toBeCloseTo(0.9, 6)
    expect(saved.width).toBeCloseTo(0.28, 6)
    expect(saved.height).toBeCloseTo(0.06, 6)
  })

  it('derives a variable key from the Hebrew label without showing syntax', async () => {
    await saveFields({ session, agreementId, fields: [field({ label: 'שם החברה', type: 'text' })] })
    const [saved] = await loadFields(versionId)
    expect(saved.label).toBe('שם החברה')
    // The user never types this; a CRM will fill it later.
    expect(saved.label).not.toContain('{{')
  })

  it('replaces the whole layout rather than accumulating', async () => {
    await saveFields({ session, agreementId, fields: [field(), field({ label: 'שם מלא', type: 'full_name' })] })
    expect(await loadFields(versionId)).toHaveLength(2)

    await saveFields({ session, agreementId, fields: [field()] })
    expect(await loadFields(versionId)).toHaveLength(1)
  })

  it('clamps a field dragged off the page instead of storing it there', async () => {
    await saveFields({ session, agreementId, fields: [field({ x: 5, y: -3 })] })
    const [saved] = await loadFields(versionId)
    expect(saved.x).toBeGreaterThanOrEqual(0)
    expect(saved.x + saved.width).toBeLessThanOrEqual(1.0001)
    expect(saved.y).toBeGreaterThanOrEqual(0)
  })

  it('rejects a page number outside the document', async () => {
    // pageCount is 3.
    expect(await saveFields({ session, agreementId, fields: [field({ page: 4 })] })).toMatchObject({ ok: false })
    expect(await saveFields({ session, agreementId, fields: [field({ page: 0 })] })).toMatchObject({ ok: false })
  })

  it('rejects NaN and non-finite coordinates', async () => {
    for (const bad of ['abc', null, Infinity, NaN]) {
      expect(await saveFields({ session, agreementId, fields: [field({ x: bad })] })).toMatchObject({
        ok: false,
      })
    }
  })

  it('rejects an unknown field type', async () => {
    expect(await saveFields({ session, agreementId, fields: [field({ type: 'password' })] })).toMatchObject({ ok: false })
  })

  it('rejects a select with no options, which could never be filled in', async () => {
    expect(
      await saveFields({ session, agreementId, fields: [field({ type: 'select', options: [] })] }),
    ).toMatchObject({ ok: false })
  })

  it('caps a very long label rather than storing it verbatim', async () => {
    await saveFields({ session, agreementId, fields: [field({ label: 'א'.repeat(5000) })] })
    const [saved] = await loadFields(versionId)
    expect(saved.label.length).toBeLessThanOrEqual(100)
  })

  it('refuses a layout with an absurd number of fields', async () => {
    const many = Array.from({ length: 500 }, () => field())
    expect(await saveFields({ session, agreementId, fields: many })).toMatchObject({ ok: false })
  })

  it('drops a value on a field the signer fills in', async () => {
    // A pre-filled value on a signer field would be us answering for them.
    await saveFields({
      session,
      agreementId,
      fields: [field({ ownedBy: 'signer', value: 'הוזרק' })],
    })
    const [saved] = await loadFields(versionId)
    expect(saved.value).toBeNull()
  })

  it('REFUSES another tenant, even with the right agreement id', async () => {
    await expect(
      saveFields({ session: intruder, agreementId, fields: [field()] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('FREEZES the layout once the document is no longer a draft', async () => {
    // Editing after sending would change what the signer agreed to.
    await db.update(schema.agreements).set({ status: 'sent' }).where(eq(schema.agreements.id, agreementId))

    const result = await saveFields({ session, agreementId, fields: [field()] })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toContain('כבר נשלח')

    await db.update(schema.agreements).set({ status: 'draft' }).where(eq(schema.agreements.id, agreementId))
  })
})

describe('saveRecipient', () => {
  it('normalises the phone to one canonical form', async () => {
    await saveRecipient({ session, agreementId, name: 'ישראל ישראלי', phone: '050-123-4567' })
    const [r] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreementId))
    expect(r.phone).toBe('+972501234567')
  })

  it('accepts an 057 number — a real supplier must be reachable', async () => {
    const result = await saveRecipient({ session, agreementId, name: 'ישראל', phone: '0571234567' })
    expect(result).toMatchObject({ ok: true })
  })

  it('rejects a landline and a malformed email, in Hebrew', async () => {
    const phone = await saveRecipient({ session, agreementId, name: 'ישראל', phone: '03-1234567' })
    expect(phone).toMatchObject({ ok: false })

    const email = await saveRecipient({ session, agreementId, name: 'ישראל', email: 'nope' })
    expect(email).toMatchObject({ ok: false })
  })

  it('updates in place rather than creating a second recipient', async () => {
    await saveRecipient({ session, agreementId, name: 'ראשון' })
    await saveRecipient({ session, agreementId, name: 'שני' })
    const rows = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreementId))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('שני')
  })

  it('REFUSES another tenant', async () => {
    await expect(
      saveRecipient({ session: intruder, agreementId, name: 'פולש' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
