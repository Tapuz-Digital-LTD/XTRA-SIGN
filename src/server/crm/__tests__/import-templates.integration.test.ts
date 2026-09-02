import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { contentHash, detectMergeTokens, importCrmTemplates, listCrmTemplates } from '../import-templates'
import { FireberryProvider } from '../fireberry'
import * as htmlToPdf from '../html-to-pdf'

/**
 * Versioning is the point of these tests.
 *
 * An imported template is a snapshot: it must never change because Fireberry
 * changed. Re-importing the same content must be refused, an edited template
 * must import beside the old one, and the old one must come out byte-identical.
 */

const db = getDb()
let orgId: string
let session: StaffSession

/** A minimal real PDF, so nothing has to launch a browser in this suite. */
const FAKE_PDF = Buffer.from(
  '255044462d312e340a312030206f626a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e656e646f626a0a322030206f626a3c3c2f54797065' +
    '2f50616765732f4b6964735b33203020525d2f436f756e7420313e3e656e646f626a0a332030206f626a3c3c2f547970652f506167652f506172656e742032203020' +
    '522f4d65646961426f785b30203020353935203834325d3e3e656e646f626a0a747261696c65723c3c2f526f6f742031203020523e3e0a2525454f46',
  'hex',
)

let crmBody = '<p>הסכם ראשון {[!accountidname]}</p>'

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `T ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `tpl-${suffix}@x.test`, name: 'a', phone: `+9727${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `tpl-${suffix}@x.test`, name: 'a', isAdmin: true }

  process.env.FIREBERRY_API_TOKEN ||= 'test-token'
})

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  await db.delete(schema.templates).where(eq(schema.templates.organizationId, orgId))
  await db.delete(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

/** Stubs the CRM and the browser; everything else is the real code path. */
function stubCrm() {
  vi.spyOn(FireberryProvider.prototype, 'listPrintTemplates').mockResolvedValue([
    { id: 't1', name: 'הסכם ספקים', modifiedOn: '2026-06-10T15:25:05', boundObject: 'הצעת מחיר' },
  ])
  vi.spyOn(FireberryProvider.prototype, 'getPrintTemplate').mockImplementation(async (id) =>
    id === 't1' ? { id: 't1', name: 'הסכם ספקים', body: crmBody, modifiedOn: '2026-06-10T15:25:05' } : null,
  )
  vi.spyOn(htmlToPdf, 'renderHtmlToPdf').mockResolvedValue(FAKE_PDF)
}

async function versions() {
  return db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.organizationId, orgId))
}

describe('importCrmTemplates', () => {
  it('imports a template as an ordinary template with no fields yet', async () => {
    stubCrm()
    const result = await importCrmTemplates({ session, templateIds: ['t1'] })
    expect(result).toMatchObject({ ok: true, imported: 1, skipped: 0, failed: [] })

    const [row] = await versions()
    expect(row.name).toBe('הסכם ספקים')
    expect(row.source).toBe('crm')
    expect(row.crmTemplateId).toBe('t1')
    expect(row.crmContentHash).toBe(contentHash(crmBody))
    expect(row.sourceFileKey).toMatch(/\.pdf$/)
    expect(row.crmSourceHtmlKey).toMatch(/\.html$/)
    expect(row.pageCount).toBe(1)
    expect(row.fields).toEqual([])
    expect(row.crmMergeFields).toEqual(['accountidname'])
  })

  it('refuses a re-import of unchanged content', async () => {
    stubCrm()
    const before = await versions()
    const result = await importCrmTemplates({ session, templateIds: ['t1'] })

    expect(result).toMatchObject({ ok: true, imported: 0, skipped: 1 })
    expect(await versions()).toHaveLength(before.length)
  })

  it('imports an edited template as a new version and leaves the old one untouched', async () => {
    stubCrm()
    const [original] = await versions()

    crmBody = '<p>הסכם מתוקן {[!accountidname]} {[!pcfsuppliers_pcfcity]}</p>'
    stubCrm()
    const result = await importCrmTemplates({ session, templateIds: ['t1'] })
    expect(result).toMatchObject({ ok: true, imported: 1 })

    const all = await versions()
    expect(all).toHaveLength(2)

    const kept = all.find((t) => t.id === original.id)!
    expect(kept.crmContentHash).toBe(original.crmContentHash)
    expect(kept.sourceFileKey).toBe(original.sourceFileKey)
    expect(kept.name).toBe(original.name)

    const added = all.find((t) => t.id !== original.id)!
    expect(added.crmContentHash).not.toBe(original.crmContentHash)
    expect(added.name).toBe('הסכם ספקים (גרסה 2)')
    expect(added.sourceFileKey).not.toBe(original.sourceFileKey)
    expect(added.crmMergeFields).toEqual(['accountidname', 'pcfsuppliers_pcfcity'])
  })

  it('reports the template as imported, with its version count', async () => {
    stubCrm()
    const result = await listCrmTemplates(session)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.templates[0]).toMatchObject({ id: 't1', imported: true, versions: 2 })
  })

  it('reports a per-template failure without losing the others', async () => {
    stubCrm()
    vi.spyOn(FireberryProvider.prototype, 'getPrintTemplate').mockResolvedValue(null)
    const result = await importCrmTemplates({ session, templateIds: ['gone'] })
    expect(result).toMatchObject({ ok: true, imported: 0 })
    if (!result.ok) return
    expect(result.failed[0].reason).toMatch(/לא נמצאה/)
  })

  it('caps how many templates one call may import', async () => {
    stubCrm()
    const result = await importCrmTemplates({ session, templateIds: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('detectMergeTokens', () => {
  it('finds tokens once each, in order', () => {
    expect(detectMergeTokens('{[!a]} x {[!b]} y {[!a]}')).toEqual(['a', 'b'])
  })
  it('finds nothing in a body without tokens', () => {
    expect(detectMergeTokens('<p>שלום</p>')).toEqual([])
  })
})
