import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { mintAdditionalSigningLink, renewSigningLink, resendAgreement } from '@/server/documents/send-agreement'
import { continueSigning, renewQuietly } from '../continue'
import { createSigningSession, hasVerifiedSessionFor, resolveSigningToken } from '../session'

/**
 * A signing link is the address of a process: when the permission behind it
 * runs out, the page renews it — quietly for a browser that already proved
 * the phone, with one button otherwise — and never makes a second agreement.
 * A message the signer still holds keeps working after a resend or a renewal.
 */

const cookieJar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
}))

const db = getDb()
let orgId: string
let session: StaffSession

async function agreement(status: 'sent' | 'signed' | 'canceled' = 'sent') {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `C ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [row] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: session.userId, companyId: company.id, title: 'הסכם', status, sentAt: new Date(), completedAt: status === 'signed' ? new Date() : null })
    .returning({ id: schema.agreements.id })
  const [version] = await db.insert(schema.agreementVersions).values({ agreementId: row.id, versionNumber: 1, sourceFileKey: 'k', pageCount: 1 }).returning({ id: schema.agreementVersions.id })
  await db.update(schema.agreements).set({ currentVersionId: version.id }).where(eq(schema.agreements.id, row.id))
  const [recipient] = await db.insert(schema.recipients).values({ agreementId: row.id, name: 'חותם', phone: '+972500000222', email: null }).returning({ id: schema.recipients.id })
  return { agreementId: row.id, recipientId: recipient.id }
}

const expired = (recipientId: string) => mintAdditionalSigningLink(recipientId, new Date(Date.now() - 1000))
const tokensOf = (recipientId: string) => db.select().from(schema.signingTokens).where(eq(schema.signingTokens.recipientId, recipientId))

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Continue ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: 'owner@xtra.test', name: 'Owner', isAdmin: true }
})

describe('continuing an expired link', () => {
  it('gives a fresh token on the same agreement, with an audit row and no second agreement', async () => {
    const { agreementId, recipientId } = await agreement()
    const old = await expired(recipientId)
    const result = await continueSigning(old.token)
    expect(result.ok && result.kind === 'ready').toBe(true)
    if (!result.ok) return
    expect(result.token).not.toBe(old.token)
    expect(result.path).toBe(`/sign/${result.token}?continue=1`)
    const live = await resolveSigningToken(result.token)
    expect(live?.agreementId).toBe(agreementId)
    const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.agreementId, agreementId), eq(schema.auditEvents.type, 'link_renewed')))
    expect(audit).toHaveLength(1)
    expect(await db.select().from(schema.agreements).where(eq(schema.agreements.companyId, live!.agreementId))).toHaveLength(0)
  })

  it('a revoked link stays dead; a canceled agreement is closed; a signed one hands out its copy', async () => {
    const open = await agreement()
    const revoked = await expired(open.recipientId)
    await db.update(schema.signingTokens).set({ revokedAt: new Date() }).where(eq(schema.signingTokens.recipientId, open.recipientId))
    expect((await continueSigning(revoked.token)).ok).toBe(false)

    const canceled = await agreement('canceled')
    const dead = await continueSigning((await expired(canceled.recipientId)).token)
    expect(dead.ok).toBe(false)
    if (!dead.ok) expect(dead.closed).toBe(true)

    const signed = await agreement('signed')
    const copy = await continueSigning((await expired(signed.recipientId)).token)
    expect(copy.ok && copy.kind === 'already_signed').toBe(true)
  })

  it('renews quietly only for a browser that already proved the phone, and the proof survives the new token', async () => {
    const { recipientId } = await agreement()
    const old = await expired(recipientId)
    cookieJar.clear()
    expect(await renewQuietly(old.token)).toBeNull()

    const [tokenRow] = await tokensOf(recipientId)
    await createSigningSession({ recipientId, tokenId: tokenRow.id })
    expect(await hasVerifiedSessionFor(recipientId)).toBe(true)
    const quiet = await renewQuietly(old.token)
    expect(quiet?.path).toMatch(/^\/sign\//)
    const fresh = await resolveSigningToken(quiet!.token)
    expect(fresh?.recipientId).toBe(recipientId)
    expect(await hasVerifiedSessionFor(recipientId)).toBe(true)
    cookieJar.clear()
  })
})

describe('older links keep working', () => {
  it('a reminder mints a second link beside the first instead of replacing it', async () => {
    const { agreementId, recipientId } = await agreement()
    const first = await mintAdditionalSigningLink(recipientId, new Date(Date.now() + 1e7))
    const result = await resendAgreement({ session, agreementId, channels: [], kind: 'reminder' })
    expect(result.ok).toBe(true)
    expect((await resolveSigningToken(first.token))?.agreementId).toBe(agreementId)
    expect(await tokensOf(recipientId)).toHaveLength(2)
  })

  it('a staff renewal keeps the old link alive too', async () => {
    const { agreementId, recipientId } = await agreement()
    const first = await mintAdditionalSigningLink(recipientId, new Date(Date.now() + 1e7))
    const result = await renewSigningLink({ session, agreementId, channels: [] })
    expect(result.ok).toBe(true)
    expect((await resolveSigningToken(first.token))?.agreementId).toBe(agreementId)
    expect(await tokensOf(recipientId)).toHaveLength(2)
  })
})
