import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, schema } from '@/server/db'
import { campaignFunnels } from '../campaign-funnels'

/**
 * The two routes, apart.
 *
 * A campaign where four people were invited by staff and three browsers found
 * the page on their own. The point of every assertion here is that the two
 * never mix: an invited person's visit is not site traffic, "ישירות" is a
 * traffic source and not an invitation, and each funnel's percentages are
 * measured against its own first step.
 */

const db = getDb()
let orgId: string
let userId: string
let groupId: string

/** A person the staff invited; `open` records that the personal link was used. */
async function invite(name: string, opts: { open?: boolean; submit?: boolean; sign?: boolean; remind?: boolean } = {}) {
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name, source: 'xtra' }).returning({ id: schema.companies.id })
  let agreementId: string | null = null
  if (opts.submit) {
    const [agreement] = await db
      .insert(schema.agreements)
      .values({
        organizationId: orgId,
        ownerId: userId,
        companyId: company.id,
        title: name,
        status: opts.sign ? 'signed' : 'sent',
        sentAt: new Date('2026-09-01T09:00:00Z'),
        completedAt: opts.sign ? new Date('2026-09-02T09:00:00Z') : null,
      })
      .returning({ id: schema.agreements.id })
    agreementId = agreement.id
    // Starting to sign is an OTP going out, whatever happened next.
    await db.insert(schema.auditEvents).values({ agreementId, type: 'otp_sent', actor: 'test' })
    if (opts.remind) await db.insert(schema.auditEvents).values({ agreementId, type: 'reminder_sent', actor: 'test', createdAt: new Date('2026-09-01T12:00:00Z') })
  }
  const [lead] = await db
    .insert(schema.projectLeads)
    .values({
      organizationId: orgId,
      groupId,
      status: opts.submit ? 'converted' : 'invited',
      source: 'invitation',
      invitedBy: userId,
      data: { name },
      formSnapshot: opts.submit ? [] : null,
      companyId: company.id,
      agreementId,
    })
    .returning({ id: schema.projectLeads.id })
  if (opts.open) {
    await db.insert(schema.campaignEvents).values({ organizationId: orgId, groupId, type: 'page_view', visitId: `inv${lead.id.slice(0, 8)}`, invitationId: lead.id })
  }
  return lead.id
}

/** A browser that found the page by itself. */
async function visitor(visitId: string, opts: { startForm?: boolean; submit?: boolean; sign?: boolean } = {}) {
  await db.insert(schema.campaignEvents).values({ organizationId: orgId, groupId, type: 'page_view', visitId, referrer: null })
  if (opts.startForm) await db.insert(schema.campaignEvents).values({ organizationId: orgId, groupId, type: 'registration_started', visitId })
  if (!opts.submit) return
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: `עצמאי ${visitId}`, source: 'xtra' }).returning({ id: schema.companies.id })
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ organizationId: orgId, ownerId: userId, companyId: company.id, title: visitId, status: opts.sign ? 'signed' : 'sent', sentAt: new Date(), completedAt: opts.sign ? new Date() : null })
    .returning({ id: schema.agreements.id })
  await db.insert(schema.auditEvents).values({ agreementId: agreement.id, type: 'otp_sent', actor: 'test' })
  await db.insert(schema.projectLeads).values({
    organizationId: orgId,
    groupId,
    status: 'converted',
    source: 'self_service',
    data: { name: `עצמאי ${visitId}` },
    formSnapshot: [],
    companyId: company.id,
    agreementId: agreement.id,
  })
}

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Funnels ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'תומר', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id })
  userId = user.id
  const [group] = await db.insert(schema.groups).values({ organizationId: orgId, name: 'קמפיין משפכים', createdBy: userId, campaignKind: 'public' }).returning({ id: schema.groups.id })
  groupId = group.id

  // Invited: four people, three opened, two submitted, one signed, one reminded.
  await invite('הוזמן ולא פתח')
  await invite('פתח ולא הגיש', { open: true })
  await invite('הגיש ולא חתם', { open: true, submit: true, remind: true })
  await invite('חתם', { open: true, submit: true, sign: true })

  // Their own way in: three browsers, two started the form, one signed.
  await visitor('own-a', { startForm: true, submit: true, sign: true })
  await visitor('own-b', { startForm: true })
  await visitor('own-c')
})

describe('campaignFunnels', () => {
  it('counts the invitation funnel from the invited people, step by step', async () => {
    const { invitations } = await campaignFunnels(groupId)
    expect(invitations.map((s) => [s.key, s.people])).toEqual([
      ['invited', 4],
      ['opened', 3],
      ['submitted', 2],
      ['started', 2],
      ['signed', 1],
    ])
    // Of the step before, and of everyone invited.
    expect(invitations[1].fromPrevious).toBe(75)
    expect(invitations[2].fromPrevious).toBeCloseTo(66.7, 1)
    expect(invitations[4].fromStart).toBe(25)
    expect(invitations[0].fromPrevious).toBeNull()
  })

  it('counts the site funnel from browsers that never used a personal link', async () => {
    const { site, headline } = await campaignFunnels(groupId)
    // Three own browsers. The invited people's visits are outreach, not traffic.
    expect(site.map((s) => [s.key, s.people])).toEqual([
      ['visitors', 3],
      ['started_form', 2],
      ['submitted', 1],
      ['started_signing', 1],
      ['signed', 1],
    ])
    expect(headline.visitors).toBe(3)
    expect(headline.sessions).toBeGreaterThanOrEqual(3)
  })

  it('keeps the two routes apart in the headline, and adds them up once', async () => {
    const { headline } = await campaignFunnels(groupId)
    expect(headline).toMatchObject({ invited: 4, invitedSigned: 1, invitedConversion: 25, siteRegistrations: 1, siteSigned: 1, signedTotal: 2 })
    // The site's conversion is measured against visitors, never against the invited.
    expect(headline.siteConversion).toBeCloseTo(33.3, 1)
    // And against the people who actually submitted a form — the rate that
    // says whether the form itself works, one visitor of three having filled it.
    expect(headline.siteSubmittedToSigned).toBe(100)
  })

  it('measures reminders without claiming they caused anything', async () => {
    const { reminders } = await campaignFunnels(groupId)
    expect(reminders).toMatchObject({ sent: 1, people: 1, signedAfter: 0, remindedNotSigned: 1 })
    // The ledger filed reminders as invitations until 2026-09-10; with none of
    // its own, the "last touch" reading is withheld rather than shown as zero.
    expect(reminders.delivered).toBeNull()
    expect(reminders.lastTouch).toBeNull()
  })

  it('names where people are stuck, and links each number at the list behind it', async () => {
    const { stuck } = await campaignFunnels(groupId, {}, '/projects/x')
    const byKey = Object.fromEntries(stuck.map((s) => [s.key, s]))
    expect(byKey.not_opened.count).toBe(1)
    expect(byKey.opened_not_submitted.count).toBe(1)
    // Two submitted a form and one of them signed; the self-serve one signed too.
    expect(byKey.submitted_not_signed.count).toBe(1)
    expect(byKey.reminded_not_signed.count).toBe(1)
    expect(byKey.not_opened.href).toBe('/projects/x?tab=joining&view=invitations&stuck=not_opened')
    // A card with nobody behind it is not drawn.
    expect(byKey.failed).toBeUndefined()
  })

  it('a range describes one cohort: people who entered inside it', async () => {
    const empty = await campaignFunnels(groupId, { from: new Date('2020-01-01'), to: new Date('2020-02-01') })
    expect(empty.headline).toMatchObject({ invited: 0, visitors: 0, signedTotal: 0 })
    expect(empty.invitations[0].fromStart).toBeNull()
  })
})
