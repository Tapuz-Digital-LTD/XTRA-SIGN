import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { callVersionsOf } from '@/lib/self-service-skins'
import { createInvitation, invitationLink } from '../invitations'

/**
 * A campaign page with more than one version of the call: the invitation
 * remembers which one it was sent with, and every personal link built for it
 * carries that version — the same address, the same form, another look.
 */

const db = getDb()
let orgId: string
let session: StaffSession
const key = () => `k-${crypto.randomUUID()}`

async function group(landingConfig: object) {
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Call', createdBy: session.userId, campaignKind: 'public', goal: 'signing', entryMethod: 'custom', kind: 'supplier', landingSlug: `call-${crypto.randomUUID().slice(0, 6)}`, landingConfig }).returning({ id: schema.groups.id })
  return g.id
}

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Calls ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: false }).returning({ id: schema.users.id })
  session = { userId: u.id, organizationId: orgId, email: 'rep@xtra.test', name: 'Rep', isAdmin: false }
})

describe('the versions of the call', () => {
  it('exist only for a campaign page that has more than one', () => {
    expect(callVersionsOf('tourism-2026').map((c) => c.key)).toEqual(['regular', 'hotel'])
    expect(callVersionsOf(null)).toEqual([])
    expect(callVersionsOf('nope')).toEqual([])
  })

  it('the hotels\' invitation links to the hotels\' call; the regular one and an unknown one do not', async () => {
    const groupId = await group({ selfService: { enabled: false, skin: 'tourism-2026' } })
    const hotel = await createInvitation(session, { groupId, operationId: key(), name: 'מלון', phone: '050-1234567', call: 'hotel' })
    const regular = await createInvitation(session, { groupId, operationId: key(), name: 'צימר', phone: '050-1234568', call: 'regular' })
    const unknown = await createInvitation(session, { groupId, operationId: key(), name: 'גלריה', phone: '050-1234569', call: 'spa' })
    const none = await createInvitation(session, { groupId, operationId: key(), name: 'חנות', phone: '050-1234560' })
    for (const r of [hotel, regular, unknown, none]) expect(r.ok).toBe(true)
    if (!hotel.ok || !regular.ok || !unknown.ok || !none.ok) return
    expect(hotel.invitation.link).toMatch(/\?xs_inv=[0-9a-f-]{36}&hotel=true$/)
    expect(regular.invitation.link).toMatch(/\?xs_inv=[0-9a-f-]{36}$/)
    expect(unknown.invitation.link).toMatch(/\?xs_inv=[0-9a-f-]{36}$/)
    expect(none.invitation.link).toMatch(/\?xs_inv=[0-9a-f-]{36}$/)
    // Built again later — for a reminder, a copied link — it still carries the version.
    expect(await invitationLink(groupId, hotel.invitation.id)).toBe(hotel.invitation.link)
  })

  it('a campaign without a branded page ignores the version', async () => {
    const groupId = await group({ title: 'טופס' })
    const created = await createInvitation(session, { groupId, operationId: key(), name: 'עסק', phone: '050-1234561', call: 'hotel' })
    expect(created.ok && created.invitation.link).toMatch(/\?xs_inv=[0-9a-f-]{36}$/)
  })
})
