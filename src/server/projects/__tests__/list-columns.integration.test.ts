import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { fieldsFor, runReport } from '@/server/reports/engine/query'
import { formColumnsOf, listColumnsOf, saveListColumns } from '../list-columns'
import { saveLandingSettings } from '../landing'

/**
 * A campaign chooses which of its form's answers are columns; the choice is
 * the project's, survives the other settings that share its column, and the
 * report engine can read every one of those answers — from the row or from
 * the agreement's frozen snapshot.
 */

const db = getDb()
let orgId: string
let session: StaffSession
let groupId: string

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Columns ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: 'rep@xtra.test', name: 'Rep', isAdmin: true }
  const [g] = await db
    .insert(schema.groups)
    .values({ organizationId: orgId, name: 'תיירות', createdBy: session.userId, campaignKind: 'public', goal: 'signing', entryMethod: 'custom', landingSlug: `cols-${crypto.randomUUID().slice(0, 6)}`, landingConfig: { selfService: { enabled: false, skin: 'tourism-2026' } } })
    .returning({ id: schema.groups.id })
  groupId = g.id
})

describe('the catalogue', () => {
  it('is the branded form when the project has a campaign page, the custom questions otherwise', () => {
    expect(formColumnsOf({ selfService: { skin: 'tourism-2026' } }).map((c) => c.key)).toContain('week')
    const custom = formColumnsOf({ fields: [{ id: 'name', label: 'שם', type: 'text' }, { id: 'custom_size', label: 'גודל', type: 'select' }, { id: 'custom_vat', label: 'עוסק מורשה', type: 'checkbox' }, { id: 'custom_gone', label: 'x', type: 'text', hidden: true }] })
    expect(custom.map((c) => c.key)).toEqual(['custom_size', 'custom_vat'])
    expect(custom[1].options).toEqual({ true: 'כן', false: 'לא' })
    expect(formColumnsOf(null)).toEqual([])
  })
})

describe('the choice', () => {
  it('keeps the order, drops what the form does not ask, and survives a settings save', async () => {
    const chosen = await saveListColumns(session, groupId, ['week', 'nope', 'commercialName', 'week', 42])
    expect(chosen.map((c) => c.key)).toEqual(['week', 'commercialName'])

    const [group] = await db.select({ landingConfig: schema.groups.landingConfig }).from(schema.groups).where(eq(schema.groups.id, groupId))
    expect(listColumnsOf(group.landingConfig).map((c) => c.key)).toEqual(['week', 'commercialName'])
    expect((group.landingConfig as { selfService?: { skin?: string } }).selfService?.skin).toBe('tourism-2026')

    // The joining form's settings share the column; saving them must not wipe the choice.
    await saveLandingSettings(session, groupId, { enabled: false, config: { title: 'טופס' } })
    const [after] = await db.select({ landingConfig: schema.groups.landingConfig }).from(schema.groups).where(eq(schema.groups.id, groupId))
    expect(listColumnsOf(after.landingConfig).map((c) => c.key)).toEqual(['week', 'commercialName'])
    expect((after.landingConfig as { selfService?: { skin?: string } }).selfService?.skin).toBe('tourism-2026')
  })
})

describe('the engine', () => {
  it('offers the branded form\'s answers and reads them from the row or the snapshot', async () => {
    const fields = await fieldsFor(session, 'people')
    const week = fields.find((f) => f.key === 'form.week')
    expect(week?.type).toBe('enum')
    expect(week?.options?.map((o) => o.value)).toContain('week_2')

    const [agreement] = await db
      .insert(schema.agreements)
      .values({ organizationId: orgId, ownerId: session.userId, title: 'ישן', status: 'sent', mergeSnapshot: { values: { week: 'week_2', commercialName: 'מהמסמך' } } })
      .returning({ id: schema.agreements.id })
    await db.insert(schema.projectLeads).values([
      { organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: 'רק במסמך' }, formSnapshot: [], agreementId: agreement.id },
      { organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: 'על השורה', commercialName: 'מהשורה' }, formSnapshot: [] },
    ])
    const report = await runReport(session, { entity: 'people', clauses: [{ any: [{ field: 'campaign', op: 'one_of', value: [groupId] }] }], columns: ['name', 'form.week', 'form.commercialName'], sort: null, page: 1, pageSize: 10 })
    const byName = Object.fromEntries(report.rows.map((r) => [r.cells.name, r.cells]))
    expect(byName['רק במסמך']['form.week']).toBe('week_2')
    expect(byName['רק במסמך']['form.commercialName']).toBe('מהמסמך')
    expect(byName['על השורה']['form.commercialName']).toBe('מהשורה')
    expect(byName['על השורה']['form.week']).toBeNull()
  })
})
