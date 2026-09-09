import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createGroup } from '@/server/groups/groups'
import { saveLandingSettings, submitLead } from '@/server/projects/landing'
import { saveProjectNotificationSettings } from '@/server/projects/notification-settings'
import { saveSelfServiceConfig } from '@/server/projects/self-service'
import { startSelfServiceSigning } from '@/server/self-service/onboarding'
import { completeSigning } from '@/server/signing/complete'
import { resolveSigningToken } from '@/server/signing/session'
import { getStorage } from '@/server/storage/blob'
import { createTemplateFromPdf } from '@/server/templates/templates'
import { InforuEmailProvider } from '../inforu'
import type { OutboundMessage } from '../types'

/**
 * The campaign's emails, end to end: a registration mails the team every
 * field the form asked — custom ones included — with a link to the right
 * record; a signature mails the team and the signer, and the signer's
 * button fetches exactly the document that was signed, through a link
 * scoped to it.
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const SIGNATURE = `data:image/png;base64,${PNG_1PX.toString('base64')}`
const db = getDb()

let admin: StaffSession
let groupId: string
let formId: string
const sent: OutboundMessage[] = []

beforeAll(async () => {
  vi.spyOn(InforuEmailProvider.prototype, 'send').mockImplementation(async (message) => {
    sent.push(message)
    return { ok: true, providerMessageId: 'test' }
  })
  const tag = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Notif ${tag}` }).returning({ id: schema.organizations.id })
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, email: `owner-${tag}@xtra.test`, name: 'Owner', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true })
    .returning({ id: schema.users.id })
  admin = { userId: user.id, organizationId: org.id, email: `owner-${tag}@xtra.test`, name: 'Owner', isAdmin: true }
  const group = await createGroup({ session: admin, name: 'קמפיין הבדיקה', kind: 'supplier' })
  if (!group.ok) throw new Error(group.message)
  groupId = group.id
  const saved = await saveProjectNotificationSettings(admin, groupId, { emails: ['team@xtra.test'], signerCopy: { enabled: true, replyTo: 'reply@xtra.test', senderName: 'צוות הקמפיין', note: 'נתראה בנובמבר!', attachPdf: true } })
  if (!saved.ok) throw new Error(saved.message)
})

afterAll(() => vi.restoreAllMocks())

describe('registration email', () => {
  it('carries every field the form asked, custom ones too, and links to the record', async () => {
    const landing = await saveLandingSettings(admin, groupId, {
      enabled: true,
      config: {
        title: 'טופס הצטרפות',
        fields: [
          { id: 'name', type: 'text', label: 'שם החברה', required: true },
          { id: 'phone', type: 'phone', label: 'טלפון', required: true },
          { id: 'custom_region', type: 'text', label: 'אזור', required: false },
          { id: 'custom_branches', type: 'number', label: 'מספר סניפים', required: false },
        ],
      },
    })
    sent.length = 0
    const result = await submitLead({
      slug: landing.slug!,
      values: { name: 'צימר בגליל', phone: '052-7654321', custom_region: 'צפון', custom_branches: '3' },
      ip: '10.0.0.9',
      source: 'landing',
      referrer: 'https://l.facebook.com/l.php?u=x',
    })
    expect(result.ok).toBe(true)

    const team = sent.find((m) => m.to === 'team@xtra.test')
    expect(team, 'the team address got the registration').toBeTruthy()
    expect(team!.subject).toContain('ספק חדש נרשם')
    expect(team!.subject).toContain('קמפיין הבדיקה')
    for (const needle of ['צימר בגליל', 'אזור', 'צפון', 'מספר סניפים', '3', 'Facebook', `/projects/${groupId}?tab=leads`, 'צפייה בליד במערכת']) {
      expect(team!.html, needle).toContain(needle)
    }
    expect(team!.html).not.toContain('{{')
  })
})

describe('signature emails', () => {
  it('mails the team and the signer; the signer button is scoped to the signed document', async () => {
    const template = await createTemplateFromPdf({ session: admin, buffer: FIXTURE, name: 'הסכם' })
    if (!template.ok) throw new Error(template.message)
    const config = await saveSelfServiceConfig(admin, groupId, { enabled: true, skin: 'tourism-2026', templateId: template.templateId, ownerUserId: admin.userId, linkTtlDays: 30 })
    if (!config.ok) throw new Error(config.message)
    const [row] = await db.select({ formId: schema.groups.landingSlug }).from(schema.groups).where(eq(schema.groups.id, groupId))
    formId = row.formId!

    sent.length = 0
    const registered = await startSelfServiceSigning({
      formId,
      values: { businessName: 'מלון החוף', taxId: '515999888', signatoryName: 'דנה כהן', signatoryRole: 'מנהלת', benefit1: '25% על כל ההזמנה', week: 'week_1', redemption: 'generic_xtra25', declareLicense: true, declareInsurance: true, phone: '052-1112233', email: 'dana@example.test' },
      idempotencyKey: `notif-${crypto.randomUUID()}`,
      ip: '10.0.0.1',
      referrer: null,
      meta: { utm_source: 'whatsapp', utm_campaign: 'nov' },
    })
    expect(registered.ok).toBe(true)
    if (!registered.ok || registered.kind !== 'ready') throw new Error('not ready')
    await registered.afterResponse()

    const registration = sent.find((m) => m.to === 'team@xtra.test' && m.subject?.includes('ספק חדש נרשם'))
    expect(registration).toBeTruthy()
    for (const needle of ['מלון החוף', '515999888', 'דנה כהן', 'מנהלת', 'WhatsApp', 'dana@example.test', '/companies/']) {
      expect(registration!.html, needle).toContain(needle)
    }

    sent.length = 0
    const context = await resolveSigningToken(registered.token)
    const done = await completeSigning({ context: context!, signatureDataUrl: SIGNATURE, signatureMethod: 'drawn', consentText: 'מאשר', token: registered.token })
    expect(done).toEqual({ ok: true })

    // The team.
    const teamSigned = sent.find((m) => m.to === 'team@xtra.test')
    expect(teamSigned).toBeTruthy()
    expect(teamSigned!.subject).toBe('הסכם נחתם – מלון החוף')
    for (const needle of ['מלון החוף', '515999888', 'דנה כהן', 'נחתם', `/documents/${registered.agreementId}`, `/api/documents/${registered.agreementId}/download`, '/companies/']) {
      expect(teamSigned!.html, needle).toContain(needle)
    }

    // The signer.
    const signer = sent.find((m) => m.to === 'dana@example.test')
    expect(signer).toBeTruthy()
    expect(signer!.subject).toContain('המסמך נחתם בהצלחה')
    expect(signer!.replyTo).toBe('reply@xtra.test')
    expect(signer!.fromName).toBe('צוות הקמפיין')
    expect(signer!.html).toContain('נתראה בנובמבר!')
    expect(signer!.html).toContain('החתימה הושלמה בהצלחה')
    expect(signer!.html).not.toContain('{{')
    expect(signer!.html).not.toContain('תודה שהצטרפתם') // generic copy; the campaign only lends its name and colours
    const link = (signer!.html ?? '').match(/\/api\/sign\/([A-Za-z0-9_-]+)\/download/)
    expect(link, 'a scoped download button').toBeTruthy()
    const resolved = await resolveSigningToken(link?.[1] ?? '')
    expect(resolved?.agreementId).toBe(registered.agreementId)

    // The attachment is the document that was signed, byte for byte.
    const [version] = await db.select({ signedFileKey: schema.agreementVersions.signedFileKey }).from(schema.agreementVersions).where(eq(schema.agreementVersions.id, context!.versionId))
    const stored = await getStorage().get(version.signedFileKey!)
    expect(signer!.attachments?.length).toBe(1)
    const attachment = signer!.attachments?.[0]
    expect(attachment?.contentType).toBe('application/pdf')
    expect(Buffer.compare(attachment?.data ?? Buffer.alloc(0), stored)).toBe(0)

    // Recorded as sent.
    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, registered.agreementId))
    expect(audits.some((a) => a.type === 'email_sent' && (a.metadata as { purpose?: string })?.purpose === 'signed_copy')).toBe(true)
  }, 20000)

  it('a campaign that turns the signer copy off sends none, and the signature still completes', async () => {
    const off = await saveProjectNotificationSettings(admin, groupId, { signerCopy: { enabled: false, replyTo: null, senderName: null, note: null, attachPdf: false } })
    if (!off.ok) throw new Error(off.message)
    sent.length = 0
    const registered = await startSelfServiceSigning({
      formId,
      values: { businessName: 'קפה בנגב', taxId: '515777666', signatoryName: 'יוסי לוי', signatoryRole: 'בעלים', benefit1: '25% על כל ההזמנה', week: 'week_1', redemption: 'generic_xtra25', declareLicense: true, declareInsurance: true, phone: '052-4445566', email: 'yossi@example.test' },
      idempotencyKey: `notif-${crypto.randomUUID()}`,
      ip: '10.0.0.2',
      referrer: null,
      meta: null,
    })
    if (!registered.ok || registered.kind !== 'ready') throw new Error('not ready')
    const context = await resolveSigningToken(registered.token)
    expect(await completeSigning({ context: context!, signatureDataUrl: SIGNATURE, signatureMethod: 'drawn', consentText: 'מאשר', token: registered.token })).toEqual({ ok: true })
    expect(sent.some((m) => m.to === 'yossi@example.test')).toBe(false)
    expect(sent.some((m) => m.to === 'team@xtra.test' && m.subject?.startsWith('הסכם נחתם'))).toBe(true)
  })
})
