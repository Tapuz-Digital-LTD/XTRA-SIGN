import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { contactPointsOf, createInvitation, normalizeContacts, sendInvitation, whatsappInvitation } from '../invitations'

/**
 * One person, several doors: an invitation may carry more than one phone
 * and one email, a send may be addressed to any of them, each address has
 * its own cooldown, and an address that is not the person's is refused.
 */

const db = getDb()
let orgId: string
let session: StaffSession
let groupId: string
const key = () => `k-${crypto.randomUUID()}`

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Multi ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: false }).returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: 'rep@xtra.test', name: 'Rep', isAdmin: false }
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Multi', createdBy: session.userId, campaignKind: 'public', goal: 'signing', entryMethod: 'custom', kind: 'supplier', landingSlug: `multi-${crypto.randomUUID().slice(0, 6)}` }).returning({ id: schema.groups.id })
  groupId = g.id
})

describe('several addresses for one person', () => {
  it('cleans them, drops duplicates, and keeps the first of each as the primary', async () => {
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'מלון הצוק', phones: ['050-1111111', '0501111111', '052 222 2222'], emails: ['Owner@Hotel.co.il', 'owner@hotel.co.il', 'desk@hotel.co.il'] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.invitation.points).toEqual({ phones: ['+972501111111', '+972522222222'], emails: ['owner@hotel.co.il', 'desk@hotel.co.il'] })
    expect(created.invitation.contact).toEqual({ phone: '+972501111111', email: 'owner@hotel.co.il' })
    const [row] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, created.invitation.id))
    expect(row.phone).toBe('+972501111111')
    expect(row.email).toBe('owner@hotel.co.il')
    expect(contactPointsOf(row)).toEqual(created.invitation.points)
  })

  it('names the address that is wrong', () => {
    const bad = normalizeContacts({ phones: ['050-1111111', '12'], emails: [] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toContain('12')
    const badMail = normalizeContacts({ phones: [], emails: ['not-an-address'] })
    expect(badMail.ok).toBe(false)
    if (!badMail.ok) expect(badMail.message).toContain('not-an-address')
    expect(normalizeContacts({ phones: [], emails: [] }).ok).toBe(false)
    expect(normalizeContacts({ phones: ['050-1111111', '050-1111112', '050-1111113', '050-1111114', '050-1111115', '050-1111116'] }).ok).toBe(false)
  })

  it('one phone and one email still work the old way', async () => {
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'ישן', phone: '050-9999999', email: 'one@x.co.il' })
    expect(created.ok && created.invitation.points).toEqual({ phones: ['+972509999999'], emails: ['one@x.co.il'] })
    const [row] = await db.select({ data: schema.projectLeads.data }).from(schema.projectLeads).where(eq(schema.projectLeads.id, created.ok ? created.invitation.id : ''))
    // A single address is not repeated as a list on the row.
    expect((row.data as Record<string, unknown>).phones).toBeUndefined()
  })
})

describe('a send addressed to one of them', () => {
  // Tests run with SIGN_LOG_NOTIFICATIONS=true: the provider logs instead of
  // sending and answers "not sent", so what is checked here is where each
  // message was addressed, not whether InforU accepted it. The per-address
  // cooldown itself is proven in the dispatcher's own tests.
  it('goes to that address, and a stranger\'s address is refused before anything is written', async () => {
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'מסעדת הים', phones: ['050-3333333', '050-4444444'] })
    if (!created.ok) throw new Error(created.message)
    const id = created.invitation.id
    await sendInvitation(session, id, 'sms', { to: '050-4444444', attemptKey: key() })
    await sendInvitation(session, id, 'sms', { to: '+972503333333', attemptKey: key() })
    const stranger = await sendInvitation(session, id, 'sms', { to: '050-5555555', attemptKey: key() })
    expect(!stranger.ok && stranger.state === 'not_eligible').toBe(true)
    const rows = await db.select({ recipient: schema.messageSends.recipient, channel: schema.messageSends.channel }).from(schema.messageSends).where(eq(schema.messageSends.leadId, id))
    expect(rows.map((r) => r.recipient).sort()).toEqual(['+972503333333', '+972504444444'])
    expect(rows.every((r) => r.channel === 'sms')).toBe(true)
  })

  it('without an address the primary one is used, as before', async () => {
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'חנות', phones: ['050-8888888', '050-8888889'] })
    if (!created.ok) throw new Error(created.message)
    await sendInvitation(session, created.invitation.id, 'sms', { attemptKey: key() })
    const [row] = await db.select({ recipient: schema.messageSends.recipient }).from(schema.messageSends).where(eq(schema.messageSends.leadId, created.invitation.id))
    expect(row.recipient).toBe('+972508888888')
  })

  it('WhatsApp opens on the number asked for', async () => {
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'גלריה', phones: ['050-6666666', '050-7777777'] })
    if (!created.ok) throw new Error(created.message)
    const share = await whatsappInvitation(session, created.invitation.id, { to: '050-7777777', attemptKey: key() })
    expect(share.ok).toBe(true)
    if (share.ok) expect(share.url.startsWith('https://wa.me/972507777777?text=')).toBe(true)
  })
})
