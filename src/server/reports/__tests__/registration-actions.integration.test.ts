import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createGroup } from '@/server/groups/groups'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { saveSelfServiceConfig } from '@/server/projects/self-service'
import { startSelfServiceSigning } from '@/server/self-service/onboarding'
import { completeSigning } from '@/server/signing/complete'
import { resolveSigningToken } from '@/server/signing/session'
import { createTemplateFromPdf } from '@/server/templates/templates'
import { mintShareLink, planRegistrationActions, registrationDetail, runRegistrationActions } from '../registration-actions'

/**
 * Acting from the report: the plan says who is eligible and who is skipped
 * and why; a reminder goes to the waiting one only; a signed one gets its
 * copy; a share link is personal and resolves to the right agreement.
 */

const db = getDb()
let admin: StaffSession
let groupId: string
let formId: string
let waitingLead = ''
let signedLead = ''
let signedAgreement = ''
const sms: string[] = []
const emails: { to: string; subject?: string }[] = []

beforeAll(async () => {
  vi.spyOn(InforuSmsProvider.prototype, 'send').mockImplementation(async (m) => {
    sms.push(m.text)
    return { ok: true, providerMessageId: 's' }
  })
  vi.spyOn(InforuEmailProvider.prototype, 'send').mockImplementation(async (m) => {
    emails.push({ to: m.to, subject: m.subject })
    return { ok: true, providerMessageId: 'e' }
  })
  const tag = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Act ${tag}` }).returning({ id: schema.organizations.id })
  const [user] = await db.insert(schema.users).values({ organizationId: org.id, email: `a-${tag}@xtra.test`, name: 'Admin', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  admin = { userId: user.id, organizationId: org.id, email: `a-${tag}@xtra.test`, name: 'Admin', isAdmin: true }
  const group = await createGroup({ session: admin, name: 'קמפיין פעולות', kind: 'supplier' })
  if (!group.ok) throw new Error(group.message)
  groupId = group.id
  const template = await createTemplateFromPdf({ session: admin, buffer: readFileSync('.design/tourism-2026/agreement.pdf'), name: 'הסכם' })
  if (!template.ok) throw new Error(template.message)
  const saved = await saveSelfServiceConfig(admin, groupId, { enabled: true, skin: 'tourism-2026', templateId: template.templateId, ownerUserId: admin.userId })
  if (!saved.ok) throw new Error(saved.message)
  formId = (await db.select({ f: schema.groups.landingSlug }).from(schema.groups).where(eq(schema.groups.id, groupId)))[0].f!

  const register = async (name: string, phone: string, email: string) => {
    const r = await startSelfServiceSigning({ formId, values: { businessName: name, taxId: `51${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7)}`, signatoryName: 'דנה כהן', signatoryRole: 'מנהלת', benefit1: '25% על כל ההזמנה', week: 'week_1', redemption: 'generic_xtra25', declareLicense: true, declareInsurance: true, phone, email }, idempotencyKey: `act-${crypto.randomUUID()}`, ip: '10.0.0.1', referrer: null, meta: { utm_source: 'whatsapp' } })
    if (!r.ok || r.kind !== 'ready') throw new Error('not ready')
    await r.afterResponse()
    return r
  }
  const a = await register('ממתין בע"מ', '052-1000001', 'wait@example.test')
  const b = await register('חתום בע"מ', '052-1000002', 'signed@example.test')
  const context = await resolveSigningToken(b.token)
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await completeSigning({ context: context!, signatureDataUrl: `data:image/png;base64,${PNG.toString('base64')}`, signatureMethod: 'drawn', consentText: 'מאשר', token: b.token })
  signedAgreement = b.agreementId
  const leads = await db.select({ id: schema.projectLeads.id, agreementId: schema.projectLeads.agreementId }).from(schema.projectLeads).where(eq(schema.projectLeads.groupId, groupId))
  waitingLead = leads.find((l) => l.agreementId === a.agreementId)!.id
  signedLead = leads.find((l) => l.agreementId === b.agreementId)!.id
})

afterAll(() => vi.restoreAllMocks())

describe('registration detail', () => {
  it('tells the whole story with the actions that fit', async () => {
    const waiting = await registrationDetail(admin, groupId, waitingLead)
    expect(waiting).toMatchObject({ business: { name: 'ממתין בע"מ', contactName: 'דנה כהן', role: 'מנהלת' }, agreement: { status: 'sent', statusLabel: 'ממתין לחתימה' }, actions: ['remind', 'resend'], shareable: true })
    expect(waiting!.submission.source).toBe('WhatsApp')
    expect(waiting!.timeline.map((t) => t.type)).toEqual(expect.arrayContaining(['registered', 'sent']))

    const signed = await registrationDetail(admin, groupId, signedLead)
    expect(signed).toMatchObject({ agreement: { status: 'signed', statusLabel: 'נחתם' }, actions: ['send_signed_copy'] })
    expect(signed!.agreement!.signedAt).toBeTruthy()
    expect(signed!.agreement!.timeToSign).toBeTruthy()
    expect(signed!.timeline.map((t) => t.type)).toEqual(expect.arrayContaining(['registered', 'signature_applied', 'completed']))

    expect(await registrationDetail(admin, crypto.randomUUID(), waitingLead).catch(() => null)).toBeNull()
  })
})

describe('bulk plan and run', () => {
  it('a reminder goes to the waiting one; the signed one is named as skipped', async () => {
    const plan = await planRegistrationActions(admin, groupId, [waitingLead, signedLead], 'remind')
    expect(plan.eligible.map((e) => e.id)).toEqual([waitingLead])
    expect(plan.skipped).toEqual([{ id: signedLead, name: 'חתום בע"מ', reason: 'כבר חתם' }])
    expect(plan.summary).toBe('התזכורת תישלח ל-1 נמענים. 1 שכבר חתמו לא יקבלו הודעה.')

    sms.length = 0
    emails.length = 0
    const run = await runRegistrationActions(admin, groupId, [waitingLead, signedLead], 'remind', ['sms', 'email'])
    expect(run.sent).toEqual([{ id: waitingLead }])
    expect(run.skipped.length).toBe(1)
    expect(sms.some((t) => t.includes('תזכורת') && t.includes('https://'))).toBe(true)
    expect(emails.some((e) => e.to === 'wait@example.test' && e.subject?.includes('תזכורת'))).toBe(true)
    const trail = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, (await db.select({ a: schema.projectLeads.agreementId }).from(schema.projectLeads).where(eq(schema.projectLeads.id, waitingLead)))[0].a!))
    expect(trail.some((t) => t.type === 'reminder_sent')).toBe(true)
  })

  it('a resend repeats the invitation; a signed copy goes by email only', async () => {
    sms.length = 0
    emails.length = 0
    const resend = await runRegistrationActions(admin, groupId, [waitingLead], 'resend', ['sms'])
    expect(resend.sent.length).toBe(1)
    expect(sms.at(-1)).toContain('נרשמתם')
    const copy = await runRegistrationActions(admin, groupId, [signedLead, waitingLead], 'send_signed_copy', [])
    expect(copy.sent).toEqual([{ id: signedLead }])
    expect(copy.skipped.map((s) => s.id)).toEqual([waitingLead])
    expect(emails.at(-1)).toMatchObject({ to: 'signed@example.test' })
    expect(emails.at(-1)!.subject).toContain('נחתם בהצלחה')
  })

  it('a share link is personal, resolves to the right agreement, and is recorded as a share, not a send', async () => {
    const share = await mintShareLink(admin, groupId, signedLead, 'whatsapp')
    expect(share.ok).toBe(true)
    if (!share.ok) return
    const token = share.url.match(/\/api\/sign\/([A-Za-z0-9_-]+)\/download/)?.[1]
    expect(token).toBeTruthy()
    expect((await resolveSigningToken(token!))?.agreementId).toBe(signedAgreement)
    expect(share.whatsappUrl.startsWith('https://wa.me/972521000002?text=')).toBe(true)
    expect(decodeURIComponent(share.whatsappUrl)).toContain(share.url)
    const trail = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, signedAgreement))
    expect(trail.some((t) => t.type === 'whatsapp_share_opened')).toBe(true)
    expect(await mintShareLink(admin, groupId, crypto.randomUUID(), 'copy')).toMatchObject({ ok: false })
  })
})
