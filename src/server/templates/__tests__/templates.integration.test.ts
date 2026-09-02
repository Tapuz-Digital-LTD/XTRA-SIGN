import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createComposedDocument } from '@/server/documents/compose'
import { loadFields, loadPageGeometry, saveFields } from '@/server/documents/save-fields'
import { fakeStorage } from '@/test/fake-storage'
import {
  createDocumentFromTemplate,
  createTemplateFromAgreement,
  deleteTemplate,
  listTemplates,
  renameTemplate,
} from '../templates'

/**
 * Templates against the real schema and the storage interface.
 *
 * The subject, as everywhere in this suite, is the boundary: a template is
 * shared inside an organization and invisible outside it, and a document made
 * from one is a full, independent document.
 */

const db = getDb()

let alice: StaffSession
let carol: StaffSession
let adminA: StaffSession
let bob: StaffSession
let sourceAgreementId: string

async function makeOrg(name: string) {
  const [row] = await db.insert(schema.organizations).values({ name }).returning({ id: schema.organizations.id })
  return row.id
}

/** Every document belongs to a company now, so each org gets one to file under. */
async function makeCompany(organizationId: string): Promise<string> {
  const [row] = await db
    .insert(schema.companies)
    .values({ organizationId, kind: 'supplier', name: `ספק ${crypto.randomUUID().slice(0, 6)}` })
    .returning({ id: schema.companies.id })
  return row.id
}

async function makeUser(organizationId: string, email: string, isAdmin = false): Promise<StaffSession> {
  const [row] = await db
    .insert(schema.users)
    .values({
      organizationId,
      email,
      name: email.split('@')[0],
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin,
    })
    .returning({ id: schema.users.id })
  return { userId: row.id, organizationId, email, name: email, isAdmin }
}

const SIGNATURE = {
  id: crypto.randomUUID(),
  type: 'signature',
  label: 'חתימה',
  ownedBy: 'signer',
  required: true,
  page: 1,
  x: 0.6,
  y: 0.8,
  width: 0.28,
  height: 0.06,
  value: null,
  options: null,
}
const COMPANY = {
  id: crypto.randomUUID(),
  type: 'text',
  label: 'שם החברה',
  ownedBy: 'sender',
  required: true,
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.24,
  height: 0.035,
  value: 'אטרקציות ישראל בע״מ',
  options: null,
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const orgA = await makeOrg(`Org A ${suffix}`)
  const orgB = await makeOrg(`Org B ${suffix}`)
  alice = await makeUser(orgA, `alice-${suffix}@xtra.test`)
  carol = await makeUser(orgA, `carol-${suffix}@xtra.test`)
  adminA = await makeUser(orgA, `admin-${suffix}@xtra.test`, true)
  bob = await makeUser(orgB, `bob-${suffix}@xtra.test`)

  // A document written in the system, laid out with two fields.
  const composed = await createComposedDocument({
    session: alice,
    title: 'הסכם ספק',
    text: '# תנאים\nהספק מתחייב.\n---\nעמוד שני',
    companyId: await makeCompany(orgA),
  })
  if (!composed.ok) throw new Error(composed.message)
  sourceAgreementId = composed.agreementId

  const saved = await saveFields({ session: alice, agreementId: sourceAgreementId, fields: [SIGNATURE, COMPANY] })
  if (!saved.ok) throw new Error(saved.message)
})

describe('saving a template', () => {
  it('copies the PDF and snapshots the layout', async () => {
    const before = fakeStorage.size()
    const result = await createTemplateFromAgreement({
      session: alice,
      agreementId: sourceAgreementId,
      name: '  הסכם   ספק סטנדרטי  ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Its own object, not the agreement's.
    expect(fakeStorage.size()).toBe(before + 1)

    const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, result.templateId))
    expect(row.name).toBe('הסכם ספק סטנדרטי')
    expect(row.pageCount).toBe(2)
    expect(row.sourceFileKey).toMatch(new RegExp(`^org/${alice.organizationId}/templates/${result.templateId}/`))
    expect((row.fields as unknown[]).length).toBe(2)
  })

  it('refuses an empty name', async () => {
    const result = await createTemplateFromAgreement({ session: alice, agreementId: sourceAgreementId, name: '   ' })
    expect(result).toEqual({ ok: false, message: 'יש להזין שם לתבנית.' })
  })

  it("REFUSES another organization's document", async () => {
    await expect(
      createTemplateFromAgreement({ session: bob, agreementId: sourceAgreementId, name: 'גניבה' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('listing', () => {
  it('shows the template to everyone in the organization and to nobody outside it', async () => {
    const forCarol = await listTemplates(carol)
    expect(forCarol.some((t) => t.name === 'הסכם ספק סטנדרטי')).toBe(true)
    const item = forCarol.find((t) => t.name === 'הסכם ספק סטנדרטי')!
    expect(item.fieldCount).toBe(2)
    expect(item.signatureCount).toBe(1)
    expect(item.pageCount).toBe(2)
    // Carol did not make it and is not an admin.
    expect(item.canManage).toBe(false)

    const forAdmin = await listTemplates(adminA)
    expect(forAdmin.find((t) => t.name === 'הסכם ספק סטנדרטי')?.canManage).toBe(true)

    const forBob = await listTemplates(bob)
    expect(forBob.some((t) => t.name === 'הסכם ספק סטנדרטי')).toBe(false)
  })
})

describe('a document from a template', () => {
  it('is a full draft: own PDF, own pages, the fields copied', async () => {
    const [template] = await db
      .select({ id: schema.templates.id, sourceFileKey: schema.templates.sourceFileKey })
      .from(schema.templates)
      .where(eq(schema.templates.name, 'הסכם ספק סטנדרטי'))

    const before = fakeStorage.size()
    // A colleague uses it — templates are shared.
    const result = await createDocumentFromTemplate({
      session: carol,
      templateId: template.id,
      companyId: await makeCompany(carol.organizationId),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // A copy under the new agreement, never the template's object.
    expect(fakeStorage.size()).toBe(before + 1)

    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.agreementId))
    expect(agreement.status).toBe('draft')
    expect(agreement.ownerId).toBe(carol.userId)
    expect(agreement.templateId).toBe(template.id)
    expect(agreement.title).toBe('הסכם ספק סטנדרטי')

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.agreementId, result.agreementId))
    expect(version.sourceFileKey).not.toBe(template.sourceFileKey)
    expect(version.sourceFileKey).toMatch(new RegExp(`^org/${carol.organizationId}/agreements/${result.agreementId}/`))
    expect(version.pageCount).toBe(2)
    expect(await loadPageGeometry(version.id)).toHaveLength(2)

    const fields = await loadFields(version.id)
    expect(fields.map((f) => [f.type, f.ownedBy, f.value])).toEqual(
      expect.arrayContaining([
        ['signature', 'signer', null],
        ['text', 'sender', 'אטרקציות ישראל בע״מ'],
      ]),
    )
  })

  it("REFUSES a template from another organization, as not-found", async () => {
    const [template] = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.name, 'הסכם ספק סטנדרטי'))
    await expect(
      createDocumentFromTemplate({ session: bob, templateId: template.id, companyId: await makeCompany(bob.organizationId) }),
    ).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      createDocumentFromTemplate({ session: bob, templateId: 'not-a-uuid', companyId: await makeCompany(bob.organizationId) }),
    ).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('managing', () => {
  it('lets the creator or an admin rename and delete, and nobody else', async () => {
    const [template] = await db
      .select({ id: schema.templates.id, sourceFileKey: schema.templates.sourceFileKey })
      .from(schema.templates)
      .where(eq(schema.templates.name, 'הסכם ספק סטנדרטי'))

    await expect(renameTemplate({ session: carol, templateId: template.id, name: 'x' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect(await renameTemplate({ session: adminA, templateId: template.id, name: 'הסכם ספק 2026' })).toEqual({ ok: true })
    expect((await listTemplates(alice)).some((t) => t.name === 'הסכם ספק 2026')).toBe(true)

    await expect(deleteTemplate({ session: carol, templateId: template.id })).rejects.toBeInstanceOf(ForbiddenError)
    expect(await deleteTemplate({ session: alice, templateId: template.id })).toEqual({ ok: true })

    // Gone from the list and from storage; the row stays for the agreements that point at it.
    expect((await listTemplates(alice)).some((t) => t.id === template.id)).toBe(false)
    expect(await fakeStorage.exists(template.sourceFileKey!)).toBe(false)
    const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, template.id))
    expect(row.deletedAt).not.toBeNull()

    // And a deleted template cannot be used.
    await expect(
      createDocumentFromTemplate({ session: alice, templateId: template.id, companyId: await makeCompany(alice.organizationId) }),
    ).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
