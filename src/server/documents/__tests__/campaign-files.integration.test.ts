import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { runReport } from '@/server/reports/engine/query'
import { projectReport } from '@/server/reports/project-report'
import { signedCampaignFiles } from '../campaign-files'
import { listDocuments } from '../queries'

/**
 * גרסת קול קורא across the campaign: the agreements tab, the ZIP of signed
 * files, the campaign report and the report builder all read one definition —
 * the snapshot decides the 18 ₪ track, the invitation decides מלונות, anyone
 * else is רגיל — and an agreement tied to the campaign only by its snapshot
 * (a business adding the second track) is still the campaign's.
 */

const db = getDb()
let admin: StaffSession
let rep: StaffSession
let campaignId: string
let plainId: string
const ids: Record<string, string> = {}

const BENEFIT18 = { withAppendix: true, redemption: '' }
const REGULAR = { withAppendix: false, redemption: 'XTRA25' }

async function agreement(key: string, input: { company: string; companyId?: string; status: 'signed' | 'viewed'; values: Record<string, unknown>; call?: string; lead?: boolean; owner?: StaffSession; group?: string }) {
  const group = input.group ?? campaignId
  const owner = input.owner ?? admin
  const companyId =
    input.companyId ??
    (await db.insert(schema.companies).values({ organizationId: admin.organizationId, kind: 'supplier', name: input.company, source: 'xtra' }).returning({ id: schema.companies.id }))[0].id
  const [a] = await db
    .insert(schema.agreements)
    .values({
      organizationId: admin.organizationId,
      ownerId: owner.userId,
      companyId,
      title: `הסכם — ${input.company}`,
      status: input.status,
      completedAt: input.status === 'signed' ? new Date('2026-10-20T10:00:00Z') : null,
      mergeSnapshot: { values: input.values, selfService: { projectId: group } },
    })
    .returning({ id: schema.agreements.id })
  const [v] = await db
    .insert(schema.agreementVersions)
    .values({ agreementId: a.id, versionNumber: 1, signedFileKey: input.status === 'signed' ? `org/${admin.organizationId}/agreements/${a.id}/signed.pdf` : null })
    .returning({ id: schema.agreementVersions.id })
  await db.update(schema.agreements).set({ currentVersionId: v.id }).where(eq(schema.agreements.id, a.id))
  if (input.lead !== false) {
    await db.insert(schema.projectLeads).values({ organizationId: admin.organizationId, groupId: group, status: 'converted', source: 'self_service', data: { name: input.company }, formSnapshot: [], companyId, agreementId: a.id, meta: input.call ? { call: input.call } : null })
  }
  ids[key] = a.id
  return companyId
}

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Calls ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  const mk = async (isAdmin: boolean): Promise<StaffSession> => {
    const [u] = await db.insert(schema.users).values({ organizationId: org.id, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'מורן', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin }).returning({ id: schema.users.id })
    return { userId: u.id, organizationId: org.id, email: `${u.id}@xtra.test`, name: 'מורן', isAdmin }
  }
  admin = await mk(true)
  rep = await mk(false)
  const [g] = await db.insert(schema.groups).values({ organizationId: org.id, name: 'חודש התיירות', createdBy: admin.userId, campaignKind: 'public', goal: 'signing', entryMethod: 'custom', landingConfig: { selfService: { skin: 'tourism-2026' } } }).returning({ id: schema.groups.id })
  campaignId = g.id
  const [h] = await db.insert(schema.groups).values({ organizationId: org.id, name: 'קמפיין אחר', createdBy: admin.userId, campaignKind: 'signature', goal: 'signing', entryMethod: 'audience' }).returning({ id: schema.groups.id })
  plainId = h.id

  const winery = await agreement('winery18', { company: 'יקב כהנוב', status: 'signed', values: BENEFIT18, call: 'benefit18' })
  // The second track of a business already signed: no registration row points at it, only its snapshot.
  await agreement('wineryRegular', { company: 'יקב כהנוב', companyId: winery, status: 'signed', values: REGULAR, lead: false })
  await agreement('museum18', { company: 'מוזיאון המושבה', status: 'signed', values: BENEFIT18, lead: false })
  await agreement('hotel', { company: 'מלון ים', status: 'signed', values: REGULAR, call: 'hotel' })
  await agreement('zimmer', { company: 'צימר "הגליל"/צפון', status: 'signed', values: REGULAR })
  await agreement('pending18', { company: 'יד שרה', status: 'viewed', values: BENEFIT18, call: 'benefit18' })
  await agreement('rep18', { company: 'בית קפה', status: 'signed', values: BENEFIT18, call: 'benefit18', owner: rep })
  await agreement('plain', { company: 'ספק אחר', status: 'signed', values: REGULAR, group: plainId })
})

describe('גרסת קול קורא', () => {
  it('the agreements tab lists snapshot-only agreements and filters by version', async () => {
    const all = await listDocuments(admin, { groupId: campaignId })
    expect(all.total).toBe(7)
    const of = async (callVersion: string) => (await listDocuments(admin, { groupId: campaignId, callVersion })).items.map((i) => i.id).sort()
    expect(await of('benefit18')).toEqual([ids.winery18, ids.museum18, ids.pending18, ids.rep18].sort())
    expect(await of('hotel')).toEqual([ids.hotel])
    expect(await of('regular')).toEqual([ids.wineryRegular, ids.zimmer].sort())
  })

  it('the ZIP takes signed files only, named by business, a repeated name told apart by its version', async () => {
    const b18 = await signedCampaignFiles(admin, campaignId, { callVersion: 'benefit18' })
    expect(b18.map((f) => f.fileName)).toEqual(['בית קפה.pdf', 'יקב כהנוב.pdf', 'מוזיאון המושבה.pdf'])
    expect(b18.find((f) => f.fileName === 'יקב כהנוב.pdf')?.id).toBe(ids.winery18)

    const all = (await signedCampaignFiles(admin, campaignId, {})).map((f) => f.fileName)
    expect(all).toEqual(['בית קפה.pdf', 'יקב כהנוב — הטבת 18 ₪.pdf', 'יקב כהנוב — רגיל.pdf', 'מוזיאון המושבה.pdf', 'מלון ים.pdf', 'צימר ״הגליל״-צפון.pdf'])

    expect(await signedCampaignFiles(admin, campaignId, { filter: 'pending' })).toEqual([])
  })

  it('a user gets only their own agreements, as with one download', async () => {
    expect((await signedCampaignFiles(rep, campaignId, { callVersion: 'benefit18' })).map((f) => f.id)).toEqual([ids.rep18])
  })

  it('the report builder: a field on agreements and people, empty outside a campaign with versions', async () => {
    const hotels = await runReport(admin, { entity: 'agreements', clauses: [{ any: [{ field: 'call_version', op: 'is', value: 'hotel' }] }], columns: ['call_version'] })
    expect(hotels.rows.map((r) => r.links.agreement)).toEqual([ids.hotel])
    expect(hotels.rows[0].cells.call_version).toBe('hotel')

    const plain = await runReport(admin, { entity: 'agreements', clauses: [{ any: [{ field: 'campaign', op: 'one_of', value: [plainId] }] }], columns: ['call_version'] })
    expect(plain.rows[0].cells.call_version).toBeNull()

    const people = await runReport(admin, { entity: 'people', clauses: [{ any: [{ field: 'call_version', op: 'is', value: 'benefit18' }] }], columns: ['name'] })
    expect(people.rows.map((r) => r.cells.name).sort()).toEqual(['בית קפה', 'יד שרה', 'יקב כהנוב'])
  })

  it('the campaign report counts one version, the snapshot-only agreement included', async () => {
    const report = await projectReport(admin, campaignId, { call: 'benefit18' })
    expect(report.kpis.signed.value).toBe(3)
    expect(report.registrations.map((r) => r.businessName).sort()).toEqual(['בית קפה', 'יד שרה', 'יקב כהנוב'])
    // The funnels count people: the two 18 ₪ registrations that signed, and no rate against every visitor.
    expect(report.funnels.headline.signedTotal).toBe(2)
    expect(report.funnels.headline.siteConversion).toBeNull()
    expect((await projectReport(admin, campaignId, { call: 'hotel' })).registrations.map((r) => r.businessName)).toEqual(['מלון ים'])
  })
})
