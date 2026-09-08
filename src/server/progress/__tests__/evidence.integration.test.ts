import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { joiningProgress } from '@/lib/joining-progress'
import { getDb, schema } from '@/server/db'
import { agreementEvidence, leadSendEvidence } from '../evidence'

/**
 * The evidence has to come from rows, not from a status name. Each case here
 * builds exactly the rows a real signer would leave behind and checks the
 * sentence a worker ends up reading.
 */
const db = getDb()
let orgId: string
let userId: string
let groupId: string

async function agreementFor(status: 'sent' | 'viewed' | 'signed', completedAt: Date | null = null) {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [agreement] = await db.insert(schema.agreements).values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: 'A', status, sentAt: new Date('2026-09-08T07:00:00Z'), completedAt }).returning({ id: schema.agreements.id })
  const [recipient] = await db.insert(schema.recipients).values({ agreementId: agreement.id, name: 'חותם', phone: '+972500000001' }).returning({ id: schema.recipients.id })
  const [lead] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: 'עסק' }, formSnapshot: [{ id: 'name', label: 'שם' }], companyId: company.id, agreementId: agreement.id }).returning({ id: schema.projectLeads.id, createdAt: schema.projectLeads.createdAt })
  return { agreementId: agreement.id, recipientId: recipient.id, leadId: lead.id, createdAt: lead.createdAt }
}
const audit = (agreementId: string, type: string, at: string) => db.insert(schema.auditEvents).values({ agreementId, type, actor: 'signer', createdAt: new Date(at) })
const send = (agreementId: string, ok: boolean, at: string) => db.insert(schema.messageSends).values({ organizationId: orgId, groupId, agreementId, channel: 'sms', event: 'registration_completed', recipient: '+972500000001', body: 'קישור לחתימה', ok, sentAt: new Date(at) })
const progressOf = async (a: Awaited<ReturnType<typeof agreementFor>>) => joiningProgress({ submittedAt: a.createdAt.toISOString(), ...(await agreementEvidence([a.agreementId])).get(a.agreementId)! })

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Progress ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  userId = u.id
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Progress', createdBy: userId, campaignKind: 'public' }).returning({ id: schema.groups.id })
  groupId = g.id
})

describe('agreementEvidence', () => {
  it('a code that was sent and never entered is not shown as verified', async () => {
    const a = await agreementFor('sent')
    await send(a.agreementId, true, '2026-09-08T07:01:00Z')
    await audit(a.agreementId, 'otp_sent', '2026-09-08T07:01:30Z')
    const e = (await agreementEvidence([a.agreementId])).get(a.agreementId)!
    expect(e.codeSentAt).not.toBeNull()
    expect(e.codeVerifiedAt).toBeNull()
    expect(e.linkOpenedAt).toBeNull()
    expect((await progressOf(a)).secondary).toBe('קישור וקוד נשלחו · טרם נפתח')
  })

  it('an opened link is read from the audit row, and says nothing about the code', async () => {
    const a = await agreementFor('viewed')
    await send(a.agreementId, true, '2026-09-08T07:01:00Z')
    await audit(a.agreementId, 'otp_sent', '2026-09-08T07:01:30Z')
    await audit(a.agreementId, 'viewed', '2026-09-08T07:05:00Z')
    const e = (await agreementEvidence([a.agreementId])).get(a.agreementId)!
    expect(e.linkOpenedAt).not.toBeNull()
    expect(e.codeVerifiedAt).toBeNull()
    expect((await progressOf(a)).secondary).toBe('קישור נפתח · טרם הושלמה חתימה')
  })

  it('a verified phone comes from the recipient row, not from a guess', async () => {
    const a = await agreementFor('viewed')
    await send(a.agreementId, true, '2026-09-08T07:01:00Z')
    await audit(a.agreementId, 'otp_sent', '2026-09-08T07:01:30Z')
    await db.update(schema.recipients).set({ verifiedAt: new Date('2026-09-08T07:06:00Z'), verifiedVia: 'sms_otp' }).where(eq(schema.recipients.id, a.recipientId))
    const p = await progressOf(a)
    expect(p.secondary).toBe('קוד אומת · טרם הושלמה חתימה')
    expect(p.steps.find((s) => s.key === 'code_verified')?.done).toBe(true)
    expect(p.steps.find((s) => s.key === 'signed')?.done).toBe(false)
  })

  it('a completed signature ends the story', async () => {
    const a = await agreementFor('signed', new Date('2026-09-08T07:10:00Z'))
    await send(a.agreementId, true, '2026-09-08T07:01:00Z')
    const p = await progressOf(a)
    expect(p.headline).toBe('ההצטרפות הושלמה')
    expect(p.next).toBeNull()
  })

  it('a refused send is evidence of failure, not of sending', async () => {
    const a = await agreementFor('sent')
    await send(a.agreementId, false, '2026-09-08T07:01:00Z')
    const e = (await agreementEvidence([a.agreementId])).get(a.agreementId)!
    expect(e.linkSentAt).toBeNull()
    expect(e.linkSendFailedAt).not.toBeNull()
    expect((await progressOf(a)).tone).toBe('danger')
  })

  it('an invited person with no agreement is judged by their own sends', async () => {
    const [lead] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId, status: 'invited', source: 'invitation', data: { name: 'מוזמן' } }).returning({ id: schema.projectLeads.id })
    await db.insert(schema.messageSends).values({ organizationId: orgId, groupId, leadId: lead.id, channel: 'sms', event: 'invitation', recipient: '+972500000009', body: 'הזמנה', ok: true, sentAt: new Date('2026-09-08T07:00:00Z') })
    const sends = (await leadSendEvidence([lead.id])).get(lead.id)!
    expect(sends.linkSentAt).not.toBeNull()
    expect(joiningProgress({ invitedAt: '2026-09-08T07:00:00Z', leadStatus: 'invited', ...sends }).headline).toBe('הוזמן, טרם נרשם')
  })
})
