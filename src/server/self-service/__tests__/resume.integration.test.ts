import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, schema } from '@/server/db'
import { mintAdditionalSigningLink } from '@/server/documents/send-agreement'
import type { SelfServiceProject } from '@/server/projects/self-service'
import { resumeSigning } from '../resume'

/**
 * Continuing a registration never makes a second one: an expired link
 * yields a fresh token on the same agreement; a signed agreement yields a
 * download link and no signing; after the campaign ends, finishing is
 * allowed only while the campaign says so.
 */

const db = getDb()
let orgId: string
let groupId: string
let userId: string

function project(over: Partial<SelfServiceProject> = {}): SelfServiceProject {
  return {
    groupId,
    organizationId: orgId,
    projectName: 'Resume',
    formId: 'form-resume',
    publicSlug: 'resume',
    registrationsOpen: true,
    registrationTarget: 'xtra_sign',
    closed: null,
    endedMessage: null,
    completionAllowed: true,
    orgWebsite: null,
    notifyEmails: [],
    config: { enabled: true, skin: null, templateId: null, ownerUserId: userId, linkTtlDays: 30, thankYouTitle: '', thankYouText: '' },
    template: { id: crypto.randomUUID(), name: 't', sourceFileKey: 'k', fields: [] },
    owner: { id: userId, email: 'o@xtra.test', name: 'Owner' },
    ...over,
  }
}

async function registration(status: 'sent' | 'signed' | 'expired') {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `R ${crypto.randomUUID().slice(0, 6)}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: 'A', status, sentAt: new Date(), completedAt: status === 'signed' ? new Date() : null })
    .returning({ id: schema.agreements.id })
  const [recipient] = await db.insert(schema.recipients).values({ agreementId: agreement.id, name: 'חותם', phone: '+972500000111', email: null }).returning({ id: schema.recipients.id })
  const [lead] = await db.insert(schema.projectLeads).values({ organizationId: orgId, groupId, status: 'converted', source: 'self_service', data: { name: 'x' }, companyId: company.id, agreementId: agreement.id }).returning({ id: schema.projectLeads.id })
  return { agreementId: agreement.id, recipientId: recipient.id, leadId: lead.id }
}

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Resume ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [u] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  userId = u.id
  const [g] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'Resume', createdBy: userId, campaignKind: 'public' }).returning({ id: schema.groups.id })
  groupId = g.id
})

describe('resume signing', () => {
  it('an expired link gives a fresh token on the same agreement, and no second agreement', async () => {
    const { agreementId, recipientId } = await registration('sent')
    const old = await mintAdditionalSigningLink(recipientId, new Date(Date.now() - 1000))
    const result = await resumeSigning(project(), { token: old.token })
    expect(result.ok && result.kind === 'ready').toBe(true)
    if (!result.ok || result.kind !== 'ready') return
    expect(result.token).not.toBe(old.token)
    const tokens = await db.select().from(schema.signingTokens).where(eq(schema.signingTokens.recipientId, recipientId))
    expect(tokens.length).toBe(2)
    const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(agreements).toHaveLength(1)
    const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.agreementId, agreementId), eq(schema.auditEvents.type, 'link_renewed')))
    expect(audit).toHaveLength(1)
  })

  it('the stable continue address works by registration id and revives an expired agreement', async () => {
    const { agreementId, leadId } = await registration('expired')
    const result = await resumeSigning(project(), { registrationId: leadId })
    expect(result.ok && result.kind === 'ready').toBe(true)
    const [after] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, agreementId))
    expect(after.status).toBe('sent')
  })

  it('a signed agreement gets a download link, not a signing', async () => {
    const { leadId } = await registration('signed')
    const result = await resumeSigning(project(), { registrationId: leadId })
    expect(result.ok && result.kind === 'already_signed').toBe(true)
  })

  it('after the end, finishing is allowed only while the campaign permits it; signed stays reachable', async () => {
    const open = await registration('sent')
    const refused = await resumeSigning(project({ registrationsOpen: false, closed: 'ended', completionAllowed: false }), { registrationId: open.leadId })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.closed).toBe(true)
    const allowed = await resumeSigning(project({ registrationsOpen: false, closed: 'ended', completionAllowed: true }), { registrationId: open.leadId })
    expect(allowed.ok).toBe(true)
    const signed = await registration('signed')
    const download = await resumeSigning(project({ registrationsOpen: false, closed: 'ended', completionAllowed: false }), { registrationId: signed.leadId })
    expect(download.ok && download.kind === 'already_signed').toBe(true)
  })

  it('a registration from another campaign is not opened here', async () => {
    const { leadId } = await registration('sent')
    const result = await resumeSigning(project({ groupId: crypto.randomUUID() }), { registrationId: leadId })
    expect(result.ok).toBe(false)
  })
})
