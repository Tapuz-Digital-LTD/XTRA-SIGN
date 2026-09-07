import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { dispatch, RESERVATION_TTL_MS, suppressContact, type DispatchLead } from '../dispatch'

/**
 * Every person-addressed message passes one door: the same attempt never
 * sends twice, two clicks at once cannot both pass the cooldown, someone
 * who asked not to be contacted is not, a signed person is never messaged,
 * and an admin's explicit override is the only way through — audited.
 */

const db = getDb()
let orgId: string
let rep: StaffSession
let admin: StaffSession
let groupId: string

async function lead(over: Partial<DispatchLead> = {}): Promise<DispatchLead> {
  const phone = `+97250${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  const [row] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId, status: 'invited', source: 'invitation', data: { name: 'אדם' }, phone, email: null, invitedBy: rep.userId }).returning({ id: schema.projectLeads.id })
  return { id: row.id, organizationId: orgId, groupId, agreementId: null, status: 'invited', phone, email: null, ...over }
}

let calls = 0
const okProvider = async () => {
  calls++
  return { ok: true, providerMessageId: `p-${calls}` }
}
const render = async () => ({ to: 'x', subject: null, body: 'שלום' })
const send = (l: DispatchLead, extra: Partial<Parameters<typeof dispatch>[0]> = {}) => dispatch({ session: rep, lead: l, processStatus: 'invited', channel: 'sms', event: 'invitation', render: async () => ({ ...(await render()), to: l.phone! }), send: okProvider, ...extra })
const rowsFor = (id: string) => db.select().from(schema.messageSends).where(eq(schema.messageSends.leadId, id))

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Dispatch ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const mk = async (isAdmin: boolean): Promise<StaffSession> => {
    const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: isAdmin ? 'Admin' : 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin }).returning({ id: schema.users.id })
    return { userId: u.id, organizationId: orgId, email: `${u.id}@xtra.test`, name: isAdmin ? 'Admin' : 'Rep', isAdmin }
  }
  rep = await mk(false)
  admin = await mk(true)
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'D', createdBy: rep.userId, campaignKind: 'signature', goal: 'signing', entryMethod: 'audience' }).returning({ id: schema.groups.id })
  groupId = g.id
})

describe('dispatch', () => {
  it('the same attempt key sends once and replays the same row', async () => {
    const l = await lead()
    const before = calls
    const first = await send(l, { attemptKey: 'attempt-1' })
    const second = await send(l, { attemptKey: 'attempt-1' })
    expect(first.ok && first.state === 'sent').toBe(true)
    expect(second.ok && second.state === 'sent' && first.ok && second.sendId === first.sendId).toBe(true)
    expect(calls - before).toBe(1)
    expect(await rowsFor(l.id)).toHaveLength(1)
  })

  it('two attempts at once: one sends, the other hits the cooldown, and the provider is called once', async () => {
    const l = await lead()
    const before = calls
    const results = await Promise.all([send(l, { attemptKey: 'a-1' }), send(l, { attemptKey: 'a-2' })])
    const sent = results.filter((r) => r.ok && r.state === 'sent')
    const refused = results.filter((r) => !r.ok && r.state === 'cooldown')
    expect(sent).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(calls - before).toBe(1)
    expect(await rowsFor(l.id)).toHaveLength(1)
  })

  it('a second send within 24 hours is refused; an admin may force it and that is audited; a rep may not', async () => {
    const l = await lead()
    expect((await send(l)).ok).toBe(true)
    const again = await send(l)
    expect(!again.ok && again.state === 'cooldown').toBe(true)
    const repForce = await send(l, { force: true })
    expect(!repForce.ok && repForce.state === 'cooldown').toBe(true)
    const adminForce = await send(l, { session: admin, force: true })
    expect(adminForce.ok && adminForce.state === 'sent').toBe(true)
    const audit = await db.select().from(schema.adminAuditEvents).where(and(eq(schema.adminAuditEvents.organizationId, orgId), eq(schema.adminAuditEvents.type, 'send_override')))
    expect(audit.some((a) => (a.metadata as { leadId?: string })?.leadId === l.id)).toBe(true)
  })

  it('someone who asked not to be contacted is not — except an explicit admin override', async () => {
    const l = await lead()
    await suppressContact(rep, { channel: 'sms', address: l.phone!, reason: 'ביקש' })
    const refused = await send(l)
    expect(!refused.ok && refused.state === 'suppressed').toBe(true)
    expect(await rowsFor(l.id)).toHaveLength(0)
    const forced = await send(l, { session: admin, force: true })
    expect(forced.ok).toBe(true)
  })

  it('a signed person, a missing address and another organisation are refused before anything is written', async () => {
    const l = await lead()
    const signed = await send(l, { processStatus: 'signed' })
    expect(!signed.ok && signed.state === 'not_eligible').toBe(true)
    const noMail = await dispatch({ session: rep, lead: l, processStatus: 'invited', channel: 'email', event: 'invitation', render, send: okProvider })
    expect(!noMail.ok && noMail.state === 'not_eligible').toBe(true)
    const foreign = await send({ ...l, organizationId: crypto.randomUUID() })
    expect(!foreign.ok && foreign.state === 'forbidden').toBe(true)
    expect(await rowsFor(l.id)).toHaveLength(0)
  })

  it('a provider failure is recorded on the reserved row and a retry with a new attempt is allowed', async () => {
    const l = await lead()
    const failing = async () => ({ ok: false, providerMessageId: null, error: 'InforU StatusId=-1' })
    const first = await send(l, { attemptKey: 'f-1', send: failing })
    expect(!first.ok && first.state === 'failed').toBe(true)
    const [row] = await rowsFor(l.id)
    expect(row.ok).toBe(false)
    expect(row.error).toBe('InforU StatusId=-1')
    const retry = await send(l, { attemptKey: 'f-2' })
    expect(retry.ok && retry.state === 'sent').toBe(true)
    expect(await rowsFor(l.id)).toHaveLength(2)
  })

  it('WhatsApp reserves the share as opened, never as sent', async () => {
    const l = await lead()
    const opened = await dispatch({ session: rep, lead: l, processStatus: 'invited', channel: 'whatsapp', event: 'invitation', render: async () => ({ to: l.phone!, subject: null, body: 'היי' }) })
    expect(opened.ok && opened.state === 'opened').toBe(true)
    const [row] = await rowsFor(l.id)
    expect(row.manualState).toBe('opened')
    expect(row.ok).toBe(false)
    // An unconfirmed open does not block trying again.
    const again = await dispatch({ session: rep, lead: l, processStatus: 'invited', channel: 'whatsapp', event: 'invitation', render: async () => ({ to: l.phone!, subject: null, body: 'היי' }) })
    expect(again.ok).toBe(true)
  })

  it('a reservation nobody finished expires: the next attempt takes the slot and the old row reads as a failure', async () => {
    const l = await lead()
    await db.insert(schema.messageSends).values({ organizationId: orgId, groupId, leadId: l.id, channel: 'sms', event: 'invitation', recipient: l.phone!, body: 'x', ok: false, error: 'reserved', sentAt: new Date(Date.now() - RESERVATION_TTL_MS - 1000) })
    const fresh = await db.insert(schema.messageSends).values({ organizationId: orgId, groupId, leadId: l.id, channel: 'email', event: 'invitation', recipient: 'a@b.co', body: 'x', ok: false, error: 'reserved' }).returning({ id: schema.messageSends.id })
    // The stale SMS reservation gives way; the fresh email one (another channel) is untouched.
    const result = await send(l, { attemptKey: 'take-1' })
    expect(result.ok && result.state === 'sent').toBe(true)
    const rows = await rowsFor(l.id)
    expect(rows.find((r) => r.channel === 'sms' && r.error === 'abandoned')).toBeTruthy()
    expect(rows.find((r) => r.id === fresh[0].id)?.error).toBe('reserved')
    // A reservation still within its time is respected.
    const emailLead = { ...l, email: 'a@b.co' }
    const blocked = await dispatch({ session: rep, lead: emailLead, processStatus: 'invited', channel: 'email', event: 'invitation', render: async () => ({ to: 'a@b.co', subject: 's', body: 'b' }), send: okProvider })
    expect(!blocked.ok && blocked.state === 'cooldown').toBe(true)
  })
})
