import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { authorizeTemplateAccess, createTemplateFromPdf } from '../templates'

/**
 * A template straight from a PDF — no agreement in between. The Ministry
 * agreement is the case: one fillable file becomes one reusable template with
 * its boxes already mapped.
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')
const db = getDb()

let alice: StaffSession
let bob: StaffSession

async function makeSession(orgName: string): Promise<StaffSession> {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: orgName }).returning({ id: schema.organizations.id })
  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: org.id,
      email: `${suffix}@xtra.test`,
      name: orgName,
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin: true,
    })
    .returning({ id: schema.users.id })
  return { userId: user.id, organizationId: org.id, email: `${suffix}@xtra.test`, name: orgName, isAdmin: true }
}

beforeAll(async () => {
  alice = await makeSession('Alice Org')
  bob = await makeSession('Bob Org')
})

describe('createTemplateFromPdf', () => {
  it('stores the flattened PDF under the template and maps the boxes to fields', async () => {
    const result = await createTemplateFromPdf({ session: alice, buffer: FIXTURE, name: 'הסכם השתתפות' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fieldCount).toBe(8)

    const template = await authorizeTemplateAccess(alice, result.templateId)
    expect(template.name).toBe('הסכם השתתפות')
    expect(template.pageCount).toBe(1)
    expect(template.sourceFileKey).toMatch(new RegExp(`^org/${alice.organizationId}/templates/`))

    const fields = template.fields as { variableKey?: string; type: string }[]
    expect(fields.map((f) => f.variableKey)).toContain('business_name')
    expect(fields.find((f) => f.variableKey === 'typed_signature')?.type).toBe('signature')

    const stored = await getStorage().get(template.sourceFileKey!)
    expect((await PDFDocument.load(stored)).getForm().getFields()).toHaveLength(0)

    // Another organization cannot see it.
    await expect(authorizeTemplateAccess(bob, result.templateId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses anything that is not a PDF, and an empty name', async () => {
    const notPdf = await createTemplateFromPdf({ session: alice, buffer: Buffer.from('hello'), name: 'x' })
    expect(notPdf.ok).toBe(false)

    const unnamed = await createTemplateFromPdf({ session: alice, buffer: FIXTURE, name: '   ' })
    expect(unnamed.ok).toBe(false)

    const rows = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.organizationId, alice.organizationId))
    expect(rows).toHaveLength(1)
  })
})
