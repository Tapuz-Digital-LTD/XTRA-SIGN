import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { eq } from 'drizzle-orm'
import { listAudience, removeInvitation } from '../invitations'

/**
 * The line the owner drew: "הזמנות ומעקב" is our own outreach that has not
 * closed. A supplier who found the campaign page and signed up on their own
 * belongs in הרשמות and must never appear there; someone we invited who then
 * registered appears in both until they sign; a signed invitation leaves the
 * list.
 */
const db = getDb()
let orgId: string
let userId: string
let groupId: string
let session: StaffSession

async function agreement(status: 'sent' | 'signed') {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [row] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: 'A', status, sentAt: new Date(), completedAt: status === 'signed' ? new Date() : null })
    .returning({ id: schema.agreements.id })
  return row.id
}

async function lead(name: string, opts: { invited?: boolean; submitted?: boolean; agreementId?: string | null; status?: string }) {
  const [row] = await db
    .insert(schema.projectLeads)
    .values({
      organizationId: orgId,
      groupId,
      status: opts.status ?? 'converted',
      source: opts.invited ? 'invitation' : 'self_service',
      invitedBy: opts.invited ? userId : null,
      data: { name },
      formSnapshot: opts.submitted ? [{ id: 'name', label: 'שם' }] : null,
      agreementId: opts.agreementId ?? null,
    })
    .returning({ id: schema.projectLeads.id })
  return row.id
}

const names = async (view: 'invitations' | 'registrations' | 'all') => (await listAudience(session, groupId, { view: view === 'registrations' ? 'all' : view, limit: 500 })).rows.map((r) => r.name)

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Views ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'נציג', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  userId = u.id
  session = { userId, organizationId: orgId, email: 'rep@xtra.test', name: 'נציג', isAdmin: true }
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Views', createdBy: userId, campaignKind: 'public', goal: 'signing' }).returning({ id: schema.groups.id })
  groupId = g.id

  await lead('מוזמן שטרם נרשם', { invited: true, status: 'invited' })
  await lead('מוזמן שנרשם ולא חתם', { invited: true, submitted: true, agreementId: await agreement('sent') })
  await lead('מוזמן שחתם', { invited: true, submitted: true, agreementId: await agreement('signed') })
  await lead('הצטרף מהאתר ולא חתם', { submitted: true, agreementId: await agreement('sent') })
  await lead('הצטרף מהאתר וחתם', { submitted: true, agreementId: await agreement('signed') })
})

describe('הזמנות ומעקב', () => {
  it('holds only invitations the team started, and only while they are open', async () => {
    expect((await names('invitations')).sort()).toEqual(['מוזמן שטרם נרשם', 'מוזמן שנרשם ולא חתם'])
  })

  it('never shows someone who joined through the campaign page', async () => {
    const rows = await names('invitations')
    expect(rows).not.toContain('הצטרף מהאתר ולא חתם')
    expect(rows).not.toContain('הצטרף מהאתר וחתם')
  })

  it('drops an invitation the moment it is signed', async () => {
    expect(await names('invitations')).not.toContain('מוזמן שחתם')
  })

  it('counts the open invitations for the overview card', async () => {
    expect((await listAudience(session, groupId, { view: 'all', limit: 1 })).counts.invitations).toBe(2)
  })

  it('counts everyone the filter matches, even when the caller asked for one row', async () => {
    // A card that fetches a single row to draw a number must still read the true total.
    const one = await listAudience(session, groupId, { view: 'all', limit: 1 })
    const many = await listAudience(session, groupId, { view: 'all', limit: 500 })
    expect(one.rows).toHaveLength(1)
    expect(one.counts).toEqual(many.counts)
    expect(one.counts.all).toBe(5)
  })

  it('keeps everyone in כל התהליכים, invited or not', async () => {
    expect((await names('all')).length).toBe(5)
  })
})

/**
 * A wrong number, a test row, a duplicate: staff must be able to take a
 * process off the list. What they must never be able to do from here is erase
 * a signature or a supplier.
 */
describe('removeInvitation', () => {
  it('takes an invitation off the list and leaves the person in the database', async () => {
    const agreementId = await agreement('sent')
    const [company] = await db.select({ id: schema.agreements.companyId }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    const id = await lead('בדיקה למחיקה', { invited: true, agreementId })
    await db.update(schema.projectLeads).set({ companyId: company.id }).where(eq(schema.projectLeads.id, id))

    expect(await removeInvitation(session, id)).toEqual({ ok: true, canceledAgreement: true })
    expect(await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, id))).toHaveLength(0)
    // The agreement is canceled, not deleted: its history stays and its link stops opening.
    expect((await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, agreementId)))[0].status).toBe('canceled')
    expect(await db.select().from(schema.companies).where(eq(schema.companies.id, company.id!))).toHaveLength(1)
  })

  it('refuses once the agreement is signed', async () => {
    const id = await lead('חתם ולא נמחק', { invited: true, submitted: true, agreementId: await agreement('signed') })
    const result = await removeInvitation(session, id)
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, id))).toHaveLength(1)
  })

  it('refuses a row from another organisation', async () => {
    const [other] = await db.insert(schema.organizations).values({ name: `Other ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
    const [u] = await db.insert(schema.users).values({ organizationId: other.id, email: `${crypto.randomUUID().slice(0, 8)}@x.test`, name: 'Z', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` }).returning({ id: schema.users.id })
    const [g] = await db.insert(schema.groups).values({ organizationId: other.id, name: 'Other', createdBy: u.id, campaignKind: 'public' }).returning({ id: schema.groups.id })
    const [theirs] = await db.insert(schema.projectLeads).values({ organizationId: other.id, groupId: g.id, status: 'invited', source: 'invitation', data: { name: 'שלהם' } }).returning({ id: schema.projectLeads.id })
    expect(await removeInvitation(session, theirs.id)).toEqual({ ok: false, message: 'לא נמצא.' })
    expect(await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, theirs.id))).toHaveLength(1)
  })

  it('records who removed what', async () => {
    const id = await lead('נמחק עם תיעוד', { invited: true, status: 'invited' })
    await removeInvitation(session, id)
    const audit = await db.select().from(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.type, 'invitation_removed'))
    expect(audit.some((a) => (a.metadata as { leadId?: string } | null)?.leadId === id && a.actorEmail === session.email)).toBe(true)
  })
})
