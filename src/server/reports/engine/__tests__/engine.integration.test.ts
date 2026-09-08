import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { buildReportWorkbook, safeCell } from '../export'
import { fieldsFor, runReport } from '../query'
import { createSavedReport, deleteSavedReport, listSavedReports, updateSavedReport } from '../saved'

/**
 * The report engine: one row per entity (a supplier with three agreements is
 * one supplier), campaign scope applied to the lateral relations, every
 * operator type, a real .xlsx, and saved reports that respect ownership.
 */

const db = getDb()
let orgId: string
let otherOrgId: string
let session: StaffSession
let other: StaffSession
let campaignId: string
let otherCampaignId: string
let supplierSigned: string
let supplierPending: string
let tagId: string

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Reports ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [org2] = await db.insert(schema.organizations).values({ name: `Other ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  otherOrgId = org2.id
  const mk = async (organizationId: string, isAdmin: boolean): Promise<StaffSession> => {
    const [u] = await db.insert(schema.users).values({ organizationId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'מורן', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin }).returning({ id: schema.users.id })
    return { userId: u.id, organizationId, email: `${u.id}@xtra.test`, name: 'מורן', isAdmin }
  }
  session = await mk(orgId, false)
  other = await mk(otherOrgId, true)
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'חודש התיירות', createdBy: session.userId, campaignKind: 'signature', goal: 'signing', entryMethod: 'custom' }).returning({ id: schema.groups.id })
  campaignId = g.id
  const [g2] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'קמפיין אחר', createdBy: session.userId, campaignKind: 'signature', goal: 'signing', entryMethod: 'audience' }).returning({ id: schema.groups.id })
  otherCampaignId = g2.id
  const [tag] = await db.insert(schema.tags).values({ organizationId: orgId, kind: 'company', name: 'צפון', nameKey: 'צפון' }).returning({ id: schema.tags.id })
  tagId = tag.id

  // A supplier who signed in the campaign and has three agreements overall (one per campaign, one loose).
  const [s1] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: 'מלון הצפון', taxId: '512345678', contactName: 'דנה', contactPhone: '+972500000101', contactEmail: 'dana@example.com', source: 'xtra' }).returning({ id: schema.companies.id })
  supplierSigned = s1.id
  await db.insert(schema.companyGroups).values({ companyId: s1.id, groupId: campaignId })
  await db.insert(schema.companyTags).values({ companyId: s1.id, tagId })
  const [a1] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: session.userId, companyId: s1.id, title: 'הסכם תיירות', status: 'signed', sentAt: new Date('2026-09-01T10:00:00Z'), completedAt: new Date('2026-09-02T10:00:00Z') }).returning({ id: schema.agreements.id })
  await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: campaignId, status: 'converted', source: 'self_service', data: { name: 'מלון הצפון', businessName: 'מלון הצפון' }, formSnapshot: [], companyId: s1.id, agreementId: a1.id, assigneeUserId: session.userId })
  await db.insert(schema.followUpTasks).values({ organizationId: orgId, groupId: campaignId, companyId: s1.id, agreementId: a1.id, kind: 'site_product', title: 'הקמת מוצר באתר', status: 'pending' })
  const [a2] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: session.userId, companyId: s1.id, title: 'הסכם אחר', status: 'sent', sentAt: new Date('2026-09-05T10:00:00Z') }).returning({ id: schema.agreements.id })
  await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: otherCampaignId, status: 'converted', source: 'self_service', data: { name: 'מלון הצפון' }, formSnapshot: [], companyId: s1.id, agreementId: a2.id })
  await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: session.userId, companyId: s1.id, title: 'הסכם ישן', status: 'canceled', sentAt: new Date('2026-08-01T10:00:00Z') })

  // A supplier in the campaign who has not signed, and one outside it (CRM).
  const [s2] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: 'צימר הגליל', taxId: '512345679', contactPhone: '+972500000102', source: 'xtra' }).returning({ id: schema.companies.id })
  supplierPending = s2.id
  await db.insert(schema.companyGroups).values({ companyId: s2.id, groupId: campaignId })
  const [a3] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: session.userId, companyId: s2.id, title: 'הסכם תיירות', status: 'sent', sentAt: new Date('2026-09-03T10:00:00Z') }).returning({ id: schema.agreements.id })
  await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId: campaignId, status: 'converted', source: 'self_service', data: { name: 'צימר הגליל' }, formSnapshot: [], companyId: s2.id, agreementId: a3.id })
  await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: 'ספק CRM', crmRecordId: 'crm-1', source: 'crm' })
  // Another organisation's supplier, never visible.
  await db.insert(schema.companies).values({ organizationId: otherOrgId, kind: 'supplier', name: 'זר', source: 'xtra' })
})

const tourism = (extraClauses: { any: { field: string; op: string; value?: unknown }[] }[] = [], columns: string[] = []) =>
  runReport(session, {
    entity: 'suppliers',
    clauses: [{ any: [{ field: 'campaigns', op: 'one_of', value: [campaignId] }] }, ...extraClauses] as never,
    columns,
    sort: { field: 'name', dir: 'asc' },
  })

describe('report engine', () => {
  it('a supplier with three agreements is one row, and the campaign scope picks the campaign agreement', async () => {
    const result = await tourism([], ['name', 'signature_status', 'signed_at', 'task_status', 'tags', 'assignee_name'])
    expect(result.total).toBe(2)
    expect(result.rows.map((r) => r.cells.name)).toEqual(['מלון הצפון', 'צימר הגליל'])
    const north = result.rows[0]
    expect(north.cells.signature_status).toBe('signed')
    expect(north.cells.task_status).toBe('pending')
    expect(north.cells.tags).toEqual(['צפון'])
    expect(north.cells.assignee_name).toBe('מורן')
    expect(north.links.company).toBe(supplierSigned)
  })

  it("the owner's example: XTRA suppliers who signed in the campaign and are not set up yet", async () => {
    const result = await tourism([
      { any: [{ field: 'data_source', op: 'is', value: 'xtra' }] },
      { any: [{ field: 'signature_status', op: 'is', value: 'signed' }] },
      { any: [{ field: 'task_status', op: 'not_one_of', value: ['done', 'not_needed'] }] },
    ])
    expect(result.total).toBe(1)
    expect(result.rows[0].links.company).toBe(supplierSigned)
  })

  it('operators: text contains, tags contains_any, date between, OR groups, is_empty', async () => {
    expect((await tourism([{ any: [{ field: 'name', op: 'contains', value: 'גליל' }] }])).rows.map((r) => r.links.company)).toEqual([supplierPending])
    expect((await tourism([{ any: [{ field: 'tags', op: 'contains_any', value: [tagId] }] }])).total).toBe(1)
    expect((await tourism([{ any: [{ field: 'tags', op: 'is_empty' }] }])).total).toBe(1)
    expect((await tourism([{ any: [{ field: 'signed_at', op: 'between', value: { from: '2026-09-01', to: '2026-09-03' } }] }])).total).toBe(1)
    expect((await tourism([{ any: [{ field: 'signed_at', op: 'between', value: { from: '2026-09-03', to: '2026-09-30' } }] }])).total).toBe(0)
    const either = await tourism([{ any: [{ field: 'name', op: 'contains', value: 'גליל' }, { field: 'name', op: 'contains', value: 'הצפון' }] }])
    expect(either.total).toBe(2)
  })

  it('never another organisation, and never a field or operator outside the registry', async () => {
    const all = await runReport(session, { entity: 'suppliers', clauses: [], columns: ['name'] })
    expect(all.rows.some((r) => r.cells.name === 'זר')).toBe(false)
    expect(all.total).toBe(3)
    await expect(runReport(session, { entity: 'suppliers', clauses: [{ any: [{ field: 'password', op: 'contains', value: 'x' }] }], columns: [] })).rejects.toThrow()
    await expect(runReport(session, { entity: 'suppliers', clauses: [{ any: [{ field: 'name', op: 'gt', value: 1 }] }] as never, columns: [] })).rejects.toThrow()
    await expect(runReport(session, { entity: 'suppliers', clauses: [], columns: [], sort: { field: 'tags', dir: 'asc' } })).rejects.toThrow()
  })

  it('people and agreements entities: one row each, campaign names, Hebrew-ready labels', async () => {
    const people = await runReport(session, { entity: 'people', clauses: [{ any: [{ field: 'campaign', op: 'one_of', value: [campaignId] }] }], columns: ['name', 'campaign', 'process_status', 'tags'] })
    expect(people.total).toBe(2)
    expect(people.rows.every((r) => r.cells.campaign === 'חודש התיירות')).toBe(true)
    const agreements = await runReport(session, { entity: 'agreements', clauses: [{ any: [{ field: 'campaign', op: 'one_of', value: [campaignId] }] }], columns: ['title', 'status', 'campaign', 'company'] })
    expect(agreements.total).toBe(2)
    const fields = await fieldsFor(session, 'agreements')
    expect(fields.find((f) => f.key === 'status')?.options?.some((o) => o.label === 'נחתם')).toBe(true)
  })

  /**
   * The campaign tabs export themselves through this engine, so the file has
   * to hold what the tab holds. "הזמנות ומעקב" is our own outreach that is
   * not signed; "הרשמות" is whoever submitted the form. If either of those
   * definitions drifts from the screen's own test, the export quietly starts
   * handing over a different list.
   */
  it("the campaign tabs' definitions: our own invitations, and who submitted a form", async () => {
    const inCampaign = { any: [{ field: 'campaign', op: 'one_of' as const, value: [campaignId] }] }

    const invited = await db
      .insert(schema.projectLeads)
      .values({ organizationId: orgId, groupId: campaignId, status: 'invited', source: 'invitation', data: { name: 'הוזמן ולא נרשם' }, invitedBy: session.userId })
      .returning({ id: schema.projectLeads.id })

    const ours = await runReport(session, {
      entity: 'people',
      clauses: [inCampaign, { any: [{ field: 'invited_by_us', op: 'is', value: true }] }, { any: [{ field: 'process_status', op: 'not_one_of', value: ['signed'] }] }],
      columns: ['name', 'source'],
      sort: null,
      page: 1,
      pageSize: 50,
    })
    expect(ours.rows.map((r) => r.cells.name)).toEqual(['הוזמן ולא נרשם'])
    expect(ours.rows[0].cells.source).toBe('הזמנה אישית')

    // The two who came through the form are the ones who submitted it; the
    // invitation above never filled anything in.
    const submitted = await runReport(session, {
      entity: 'people',
      clauses: [inCampaign, { any: [{ field: 'submitted', op: 'is', value: true }] }],
      columns: ['name'],
      sort: null,
      page: 1,
      pageSize: 50,
    })
    expect(submitted.total).toBe(2)
    expect(submitted.rows.map((r) => r.cells.name)).not.toContain('הוזמן ולא נרשם')

    // And "כל התהליכים" is every one of them.
    const all = await runReport(session, { entity: 'people', clauses: [inCampaign], columns: ['name'], sort: null, page: 1, pageSize: 50 })
    expect(all.total).toBe(3)

    await db.delete(schema.projectLeads).where(eq(schema.projectLeads.id, invited[0].id))
  })

  it('paging is on the server', async () => {
    const page1 = await runReport(session, { entity: 'suppliers', clauses: [], columns: ['name'], sort: { field: 'name', dir: 'asc' }, page: 1, pageSize: 2 })
    const page2 = await runReport(session, { entity: 'suppliers', clauses: [], columns: ['name'], sort: { field: 'name', dir: 'asc' }, page: 2, pageSize: 2 })
    expect(page1.rows).toHaveLength(2)
    expect(page2.rows).toHaveLength(1)
    expect(page1.total).toBe(3)
  })

  it('exports a real workbook with Hebrew headers and neutralised formulas', async () => {
    await db.update(schema.companies).set({ notes: '=SUM(A1:A9)' }).where(eq(schema.companies.id, supplierPending))
    const { buffer, rows } = await buildReportWorkbook(session, { entity: 'suppliers', clauses: [{ any: [{ field: 'campaigns', op: 'one_of', value: [campaignId] }] }], columns: ['name', 'tax_id', 'signature_status', 'signed_at'], extraColumns: ['notes'], sort: { field: 'name', dir: 'asc' } })
    expect(rows).toBe(2)
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    const { default: ExcelJS } = await import('exceljs')
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(buffer as unknown as ArrayBuffer)
    const sheet = book.worksheets[0]
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(['שם העסק', 'סטטוס חתימה', 'הערות']))
    const status = sheet.getRow(2).getCell(3).value
    expect(status).toBe('נחתם')
    const notes = sheet.getRow(3).getCell(5).value
    expect(String(notes)).toBe("'=SUM(A1:A9)")
    expect(safeCell('+1')).toBe("'+1")
    expect(safeCell('שלום')).toBe('שלום')
  })

  it('saved reports: mine and shared are listed; only the owner or an admin edits or deletes', async () => {
    const definition = { entity: 'suppliers' as const, clauses: [], columns: ['name'], sort: null }
    const mine = await createSavedReport(session, { name: '  ספקי צפון  ', definition, shared: false })
    expect(mine.ok && mine.report.name === 'ספקי צפון').toBe(true)
    const shared = await createSavedReport(session, { name: 'לצוות', definition, shared: true })
    expect(shared.ok).toBe(true)
    const listed = await listSavedReports(session)
    expect(listed.map((r) => r.name)).toEqual(expect.arrayContaining(['ספקי צפון', 'לצוות']))
    if (!mine.ok || !shared.ok) return
    expect((await updateSavedReport(other, mine.report.id, { name: 'גנוב' })).ok).toBe(false)
    expect((await deleteSavedReport(other, shared.report.id)).ok).toBe(false)
    expect((await updateSavedReport(session, mine.report.id, { name: 'ספקי צפון 2' })).ok).toBe(true)
    expect((await deleteSavedReport(session, mine.report.id)).ok).toBe(true)
    expect((await createSavedReport(session, { name: 'x', definition: { entity: 'nope' }, shared: false })).ok).toBe(false)
  })
})
