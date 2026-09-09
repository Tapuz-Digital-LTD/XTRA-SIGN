import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// The "come back and sign" message normally waits a few minutes for the
// visit to end; here it goes out at once so the deliveries can be asserted.
vi.hoisted(() => {
  process.env.SIGN_SELF_SERVICE_LINK_AFTER_MS = '0'
})
import type { StaffSession } from '@/server/auth/session'
import { extractPdfText } from '@/server/crm/__tests__/pdf-text'
import { getDb, schema } from '@/server/db'
import { loadFields } from '@/server/documents/save-fields'
import { createGroup } from '@/server/groups/groups'
import { saveSelfServiceConfig } from '@/server/projects/self-service'
import { completeSigning } from '@/server/signing/complete'
import { resolveSigningToken } from '@/server/signing/session'
import { getStorage } from '@/server/storage/blob'
import { createTemplateFromPdf } from '@/server/templates/templates'
import { startSelfServiceSigning, validateRegistration } from '../onboarding'

/**
 * The whole self-service journey against the real schema, the real PDF and
 * the real signing engine — with the network stubbed (log-only messages,
 * in-memory storage).
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')
const db = getDb()

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SIGNATURE = `data:image/png;base64,${PNG_1PX.toString('base64')}`

let admin: StaffSession
let groupId: string
let FORM_ID: string

const values = (overrides: Record<string, unknown> = {}) => ({
  businessName: 'מלון הנוף הצפוני',
  taxId: '515123456',
  signatoryName: 'ישראל ישראלי',
  signatoryRole: 'מנכ"ל',
  phone: '052-1234567',
  email: 'Israel@Example.com',
  ...overrides,
})

function register(key: string, overrides: Record<string, unknown> = {}) {
  return startSelfServiceSigning({
    formId: FORM_ID,
    values: values(overrides),
    idempotencyKey: key,
    ip: '10.0.0.1',
    referrer: 'https://example.com/campaign',
    meta: { utm_source: 'facebook', utm_campaign: 'nov', junk: 'dropped', landing_url: 'https://x/tourism-2026' },
  })
}


/** A submission that arrived through a personal invitation's link. */
function registerAs(key: string, meta: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return startSelfServiceSigning({
    formId: FORM_ID,
    values: values(overrides),
    idempotencyKey: key,
    ip: '10.0.0.1',
    referrer: 'https://example.com/campaign',
    meta: { landing_url: 'https://x/tourism-2026', ...meta },
  })
}

/** The row a staff member creates when they invite someone personally. */
async function invite(name: string, phone: string) {
  const [row] = await db
    .insert(schema.projectLeads)
    .values({ organizationId: admin.organizationId, groupId, status: 'invited', source: 'invitation', data: { name, businessName: name }, phone, invitedBy: admin.userId, inviteChannel: 'sms' })
    .returning()
  return row
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Tourism ${suffix}` }).returning({ id: schema.organizations.id })
  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: org.id,
      email: `tomer-${suffix}@xtra.test`,
      name: 'Tomer',
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin: true,
    })
    .returning({ id: schema.users.id })
  admin = { userId: user.id, organizationId: org.id, email: `tomer-${suffix}@xtra.test`, name: 'Tomer', isAdmin: true }

  const group = await createGroup({ session: admin, name: 'חודש התיירות הישראלית 2026', kind: 'supplier' })
  if (!group.ok) throw new Error(group.message)
  groupId = group.id
  const template = await createTemplateFromPdf({ session: admin, buffer: FIXTURE, name: 'הסכם השתתפות' })
  if (!template.ok) throw new Error(template.message)
  const saved = await saveSelfServiceConfig(admin, groupId, {
    enabled: true,
    skin: 'tourism-2026',
    templateId: template.templateId,
    ownerUserId: admin.userId,
    linkTtlDays: 30,
  })
  if (!saved.ok) throw new Error(saved.message)
  const [row] = await db.select({ formId: schema.groups.landingSlug }).from(schema.groups).where(eq(schema.groups.id, groupId))
  FORM_ID = row.formId!
})

describe('validateRegistration', () => {
  it('names every bad field and normalises the good ones', () => {
    const bad = validateRegistration({ businessName: 'x', taxId: '12', signatoryName: '', signatoryRole: '', phone: '03-1234567', email: 'nope' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(Object.keys(bad.fields).sort()).toEqual(['businessName', 'email', 'phone', 'signatoryName', 'signatoryRole', 'taxId'])

    const good = validateRegistration(values({ taxId: '515-123-456', phone: '+972 52 123 4567' }))
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.data.taxId).toBe('515123456')
    expect(good.data.phone).toBe('+972521234567')
    expect(good.data.email).toBe('israel@example.com')
  })
})

describe('startSelfServiceSigning', () => {
  let firstAgreementId: string
  let firstToken: string

  it('creates supplier, membership, a filled agreement and a signing link, and records the registration', async () => {
    const result = await register('key-1')
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'ready') return
    firstAgreementId = result.agreementId
    firstToken = result.token
    expect(result.maskedPhone).toBe('052-XXX-4567')
    // Log-only mode: the code comes back instead of an SMS.
    expect(result.otp.sent).toBe(true)
    expect(result.otp.devCode).toMatch(/^\d{6}$/)

    const [supplier] = await db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.organizationId, admin.organizationId), eq(schema.companies.taxId, '515123456')))
    expect(supplier.kind).toBe('supplier')
    expect(supplier.contactPhone).toBe('+972521234567')
    expect(supplier.contactEmail).toBe('israel@example.com')

    const membership = await db
      .select()
      .from(schema.companyGroups)
      .where(and(eq(schema.companyGroups.groupId, groupId), eq(schema.companyGroups.companyId, supplier.id)))
    expect(membership).toHaveLength(1)

    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.agreementId))
    expect(agreement.status).toBe('sent')
    expect(agreement.companyId).toBe(supplier.id)
    expect(agreement.ownerId).toBe(admin.userId)
    expect(agreement.title).toContain('מלון הנוף הצפוני')
    expect((agreement.mergeSnapshot as { selfService: { projectId: string } }).selfService.projectId).toBe(groupId)

    const fields = await loadFields(agreement.currentVersionId!)
    const byKey = Object.fromEntries(fields.map((f) => [f.variableKey, f]))
    expect(byKey.business_name.value).toBe('מלון הנוף הצפוני')
    expect(byKey.company_number.value).toBe('515123456')
    expect(byKey.contact_phone.value).toBe('052-1234567')
    expect(byKey.contact_email.value).toBe('israel@example.com')
    expect(byKey.authorized_signatory.value).toBe('ישראל ישראלי')
    expect(byKey.signatory_role.value).toBe('מנכ"ל')
    expect(byKey.typed_signature.ownedBy).toBe('signer')
    expect(byKey.signature_date.autoFill).toBe(true)

    const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id))
    expect(recipient.name).toBe('ישראל ישראלי')
    expect(recipient.phone).toBe('+972521234567')

    const context = await resolveSigningToken(result.token)
    expect(context?.agreementId).toBe(agreement.id)

    const [registration] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.groupId, groupId))
    expect(registration.status).toBe('converted')
    expect(registration.companyId).toBe(supplier.id)
    expect(registration.agreementId).toBe(agreement.id)
    expect(registration.source).toBe('self_service')
    expect(registration.meta).toMatchObject({ utm_source: 'facebook', utm_campaign: 'nov', landing_url: 'https://x/tourism-2026' })
    expect((registration.meta as Record<string, unknown>).junk).toBeUndefined()

    // Deliveries happen after the response, and are recorded either way.
    await result.afterResponse()
    const deliveries = await db.select().from(schema.deliveries).where(eq(schema.deliveries.agreementId, agreement.id))
    expect(deliveries.map((d) => d.channel).sort()).toEqual(['email', 'sms'])
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.organizationId, admin.organizationId))
    expect(notes.some((n) => n.title.includes('הרשמה חדשה'))).toBe(true)
  })

  it('replays the same key: same agreement, a second working link, no second supplier', async () => {
    const again = await register('key-1')
    expect(again.ok).toBe(true)
    if (!again.ok || again.kind !== 'ready') return
    expect(again.agreementId).toBe(firstAgreementId)
    expect(again.token).not.toBe(firstToken)
    expect((await resolveSigningToken(again.token))?.agreementId).toBe(firstAgreementId)
    expect((await resolveSigningToken(firstToken))?.agreementId).toBe(firstAgreementId)

    const suppliers = await db.select().from(schema.companies).where(eq(schema.companies.organizationId, admin.organizationId))
    expect(suppliers).toHaveLength(1)
    const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, admin.organizationId))
    expect(agreements).toHaveLength(1)
  })

  it('matches the supplier through formatting differences and reuses the open agreement for identical details', async () => {
    const result = await register('key-2', { taxId: '515-123-456', phone: '+972-52-123-4567', email: 'ISRAEL@example.com' })
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'ready') return
    expect(result.agreementId).toBe(firstAgreementId)
    const suppliers = await db.select().from(schema.companies).where(eq(schema.companies.organizationId, admin.organizationId))
    expect(suppliers).toHaveLength(1)
  })

  it('supersedes the open agreement when the details changed', async () => {
    const result = await register('key-3', { signatoryName: 'דנה כהן', signatoryRole: 'סמנכ"לית' })
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'ready') return
    expect(result.agreementId).not.toBe(firstAgreementId)

    const [old] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, firstAgreementId))
    expect(old.status).toBe('canceled')
    expect(await resolveSigningToken(firstToken)).toBeNull()

    const suppliers = await db.select().from(schema.companies).where(eq(schema.companies.organizationId, admin.organizationId))
    expect(suppliers).toHaveLength(1)
    firstAgreementId = result.agreementId
    firstToken = result.token
  })

  it('signs through the ordinary engine and stamps the form values into the original PDF', async () => {
    const context = await resolveSigningToken(firstToken)
    expect(context).not.toBeNull()
    const done = await completeSigning({
      context: context!,
      signatureDataUrl: SIGNATURE,
      signatureMethod: 'drawn',
      consentText: 'מאשר',
    })
    expect(done).toEqual({ ok: true })

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.agreementId, firstAgreementId))
    const signed = await getStorage().get(version.signedFileKey!)
    const text = await extractPdfText(signed)
    expect(text).toContain('515123456')
    expect(text).toContain('052-1234567')
    expect(text).toContain('israel@example.com')
    // The legal copy is still there, untouched.
    expect(text).toContain('XTRA25')
    // The signing date is stamped on the Israel calendar, dd/mm/yyyy.
    const today = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date())
    expect(text).toContain(today)

    // The signer's copy email was attempted (log-only here, so recorded as
    // failed) and tagged, so the thank-you page can tell the truth about it.
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, firstAgreementId))
    const copy = audit.find((e) => (e.metadata as { purpose?: string } | null)?.purpose === 'signed_copy')
    expect(copy?.type).toBe('email_failed')
  })

  it('refuses a second signature: the business already signed', async () => {
    const result = await register('key-4', { signatoryName: 'דנה כהן', signatoryRole: 'סמנכ"לית' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('already_signed')
    if (result.kind !== 'already_signed') return
    expect(result.maskedContact).toBe('052-XXX-4567')
    await result.afterResponse()

    const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.organizationId, admin.organizationId))
    expect(agreements.filter((a) => a.status === 'signed')).toHaveLength(1)
    expect(agreements).toHaveLength(2)
  })

  it('creates a separate supplier on a name-only match and says so', async () => {
    const result = await register('key-5', { taxId: '511111111', phone: '054-7654321', email: 'other@example.com' })
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'ready') return
    await result.afterResponse()
    const suppliers = await db.select().from(schema.companies).where(eq(schema.companies.organizationId, admin.organizationId))
    expect(suppliers).toHaveLength(2)
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.organizationId, admin.organizationId))
    expect(notes.some((n) => n.title.includes('כבר קיים'))).toBe(true)
  })


  /**
   * The whole point of a personal invitation: one process, from the message
   * to the signature. The link carries the invitation's id, and everything
   * that happens afterwards has to stay attached to it.
   */
  describe('a personal invitation', () => {
    it('is claimed by the submission that came through its link — one row, and the recruitment source survives', async () => {
      const invitation = await invite('מלון ההזמנה', '+972521110001')
      const result = await registerAs('inv-1', { xs_inv: invitation.id }, { businessName: 'מלון ההזמנה', taxId: '515123001', phone: '0521110001', email: 'inv1@example.com' })
      expect(result.ok).toBe(true)
      if (!result.ok || result.kind !== 'ready') return

      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110001'))
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row.id).toBe(invitation.id)
      expect(row.status).toBe('converted')
      expect(row.agreementId).toBe(result.agreementId)
      expect(row.formSnapshot).not.toBeNull()
      // How they were recruited is not overwritten by what they then did.
      expect(row.source).toBe('invitation')
      expect(row.invitedBy).toBe(admin.userId)
    })

    it('is claimed by contact details when the link lost its id — the case that forked the process in production', async () => {
      const invitation = await invite('מלון בלי מזהה', '+972521110002')
      const result = await registerAs('inv-2', {}, { businessName: 'מלון בלי מזהה', taxId: '515123002', phone: '0521110002', email: 'inv2@example.com' })
      expect(result.ok).toBe(true)

      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110002'))
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(invitation.id)
      expect(rows[0].source).toBe('invitation')
    })

    it('is claimed even when a crashed attempt left it mid-way, rather than forking', async () => {
      const invitation = await invite('מלון תקוע', '+972521110003')
      await db.update(schema.projectLeads).set({ status: 'failed' }).where(eq(schema.projectLeads.id, invitation.id))
      const result = await registerAs('inv-3', { xs_inv: invitation.id }, { businessName: 'מלון תקוע', taxId: '515123003', phone: '0521110003', email: 'inv3@example.com' })
      expect(result.ok).toBe(true)

      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110003'))
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(invitation.id)
    })

    it('does not fork on a second try from a new browser: the same agreement comes back', async () => {
      const invitation = await invite('מלון פעמיים', '+972521110004')
      const first = await registerAs('inv-4a', { xs_inv: invitation.id }, { businessName: 'מלון פעמיים', taxId: '515123004', phone: '0521110004', email: 'inv4@example.com' })
      expect(first.ok).toBe(true)
      if (!first.ok || first.kind !== 'ready') return
      // A different idempotency key is a different browser, not a different person.
      const second = await registerAs('inv-4b', { xs_inv: invitation.id }, { businessName: 'מלון פעמיים', taxId: '515123004', phone: '0521110004', email: 'inv4@example.com' })
      expect(second.ok).toBe(true)
      if (!second.ok || second.kind !== 'ready') return
      expect(second.agreementId).toBe(first.agreementId)

      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110004'))
      expect(rows).toHaveLength(1)
    })

    it('never claims somebody else: a registration with no invitation of its own stays its own row', async () => {
      const result = await registerAs('inv-5', {}, { businessName: 'נרשם מעצמו', taxId: '515123005', phone: '0521110005', email: 'inv5@example.com' })
      expect(result.ok).toBe(true)
      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110005'))
      expect(rows).toHaveLength(1)
      // Recruited by nobody: it must not read as a personal invitation.
      expect(rows[0].invitedBy).toBeNull()
      expect(rows[0].source).toBe('self_service')
    })

    it('refuses an ambiguous contact match rather than guessing between two invitations', async () => {
      await invite('כפילות א', '+972521110006')
      await invite('כפילות ב', '+972521110006')
      const result = await registerAs('inv-6', {}, { businessName: 'כפילות ג', taxId: '515123006', phone: '0521110006', email: 'inv6@example.com' })
      expect(result.ok).toBe(true)
      const rows = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.phone, '+972521110006'))
      // The two invitations are untouched and the submission made its own row.
      expect(rows).toHaveLength(3)
      expect(rows.filter((r) => r.status === 'invited')).toHaveLength(2)
    })
  })

  it('reports field errors without touching the database', async () => {
    const before = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.groupId, groupId))
    const result = await register('key-6', { taxId: 'abc', email: 'x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.fields).toMatchObject({ taxId: expect.any(String), email: expect.any(String) })
    const after = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.groupId, groupId))
    expect(after).toHaveLength(before.length)
  })
})
