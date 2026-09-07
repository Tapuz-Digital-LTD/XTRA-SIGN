import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { hashToken } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import { listDocuments } from '@/server/documents/queries'
import { attentionForAgreements, registrationAttention, topReason } from '../attention'
import { bulkResendFailed, resendFailedMessage, resolveFailure } from '../resend'

/**
 * "דורשים טיפול": what needs a person, and only that. A failed message is a
 * fact about the message; the signature stays what it is. Sending again
 * touches one message and nothing else.
 */

const provider = { ok: true, error: 'InforU StatusId=-1 mailing list failed' }
const sent: { channel: string; to: string; subject?: string; text: string }[] = []

vi.mock('@/server/notifications/inforu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/notifications/inforu')>()
  const fake = (channel: 'sms' | 'email') =>
    class {
      readonly channel = channel
      isConfigured() {
        return true
      }
      async send(message: { to: string; text: string; subject?: string }) {
        sent.push({ channel, to: message.to, subject: message.subject, text: message.text })
        return provider.ok ? { ok: true as const, providerMessageId: 'test' } : { ok: false as const, error: provider.error, providerMessageId: null }
      }
    }
  return { ...actual, logOnlyMode: () => false, InforuSmsProvider: fake('sms'), InforuEmailProvider: fake('email') }
})

const db = getDb()
const DAY = 24 * 60 * 60 * 1000
let orgId: string
let session: StaffSession
let companyId: string

async function seed(input: {
  title: string
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'canceled'
  companyId?: string | null
  sentAt?: Date | null
  expiresAt?: Date | null
  recipient?: { name: string; phone?: string; email?: string }
}) {
  const [agreement] = await db
    .insert(schema.agreements)
    .values({
      organizationId: orgId,
      title: input.title,
      status: input.status,
      ownerId: session.userId,
      companyId: input.companyId === undefined ? companyId : input.companyId,
      sentAt: input.sentAt ?? new Date(Date.now() - DAY),
      expiresAt: input.expiresAt === undefined ? new Date(Date.now() + 10 * DAY) : input.expiresAt,
    })
    .returning({ id: schema.agreements.id })
  if (input.recipient) await db.insert(schema.recipients).values({ agreementId: agreement.id, ...input.recipient })
  return agreement.id
}

async function send(
  agreementId: string,
  input: { channel: 'sms' | 'email' | 'whatsapp'; event: string; recipient: string; ok: boolean; error?: string; sentAt?: Date; resolvedAt?: Date; manualState?: string },
) {
  const [row] = await db
    .insert(schema.messageSends)
    .values({
      organizationId: orgId,
      agreementId,
      channel: input.channel,
      event: input.event,
      recipient: input.recipient,
      subject: input.channel === 'email' ? 'העותק החתום שלך' : null,
      body: 'שלום, מצורף העותק החתום. https://sign.test/api/sign/abc/download',
      ok: input.ok,
      error: input.ok ? null : (input.error ?? 'InforU StatusId=-1 rejected'),
      sentAt: input.sentAt ?? new Date(),
      resolvedAt: input.resolvedAt ?? null,
      manualState: input.manualState ?? null,
    })
    .returning({ id: schema.messageSends.id })
  return row.id
}

const audit = (agreementId: string, type: string, createdAt = new Date()) =>
  db.insert(schema.auditEvents).values({ agreementId, type, actor: 'system', createdAt })

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `AT ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: orgId, email: `at-${suffix}@x.test`, name: 'תומר', phone: `+9725${suffix.slice(0, 7)}`, isAdmin: true })
    .returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: `at-${suffix}@x.test`, name: 'תומר', isAdmin: true }
  const [company] = await db
    .insert(schema.companies)
    .values({ organizationId: orgId, kind: 'customer', name: 'מלון הים' })
    .returning({ id: schema.companies.id })
  companyId = company.id
})

afterAll(async () => {
  const ids = (await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).map((a) => a.id)
  if (ids.length) {
    await db.delete(schema.messageSends).where(inArray(schema.messageSends.agreementId, ids))
    await db.delete(schema.auditEvents).where(inArray(schema.auditEvents.agreementId, ids))
    await db.delete(schema.deliveries).where(inArray(schema.deliveries.agreementId, ids))
    const recips = (await db.select({ id: schema.recipients.id }).from(schema.recipients).where(inArray(schema.recipients.agreementId, ids))).map((r) => r.id)
    if (recips.length) await db.delete(schema.signingTokens).where(inArray(schema.signingTokens.recipientId, recips))
    await db.delete(schema.recipients).where(inArray(schema.recipients.agreementId, ids))
  }
  await db.delete(schema.notifications).where(eq(schema.notifications.organizationId, orgId))
  await db.delete(schema.agreements).where(eq(schema.agreements.organizationId, orgId))
  await db.delete(schema.companies).where(eq(schema.companies.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

beforeEach(() => {
  provider.ok = true
  sent.length = 0
})

const reasonsOf = async (id: string) => (await attentionForAgreements(orgId, [id])).get(id) ?? []

describe('reasons', () => {
  it('a signed copy that could not reach a bad address: fix the email, the signature stays', async () => {
    const id = await seed({ title: 'כתובת שגויה', status: 'signed', recipient: { name: 'רפי', email: 'rafi@gmail..com' } })
    const sendId = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'rafi@gmail..com', ok: false, error: 'InforU StatusId=-1 mailing list failed' })
    const reasons = await reasonsOf(id)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({
      key: 'invalid_email',
      severity: 1,
      title: 'ההסכם נחתם, אך המייל עם העותק החתום לא נשלח לחותם',
      action: { kind: 'fix_email', label: 'תקן כתובת מייל ושלח שוב', sendId, channel: 'email' },
      canActNow: true,
    })
    expect(reasons[0].explanation).toContain('ra…@gmail..com')
    expect(reasons[0].explanation).not.toMatch(/InforU|StatusId/)
    // The row in the list carries it, and the status is untouched.
    const listed = await listDocuments(session, { search: 'כתובת שגויה' })
    expect(listed.items[0].status).toBe('signed')
    expect(listed.items[0].attention?.key).toBe('invalid_email')
  })

  it('a failed send to a fine address asks to send the same message again', async () => {
    const id = await seed({ title: 'ספק נפל', status: 'signed', recipient: { name: 'דנה', email: 'dana@example.com' } })
    const sendId = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'dana@example.com', ok: false, error: 'InforU unreachable' })
    expect(topReason(await reasonsOf(id))).toMatchObject({ key: 'send_failed', action: { kind: 'resend_message', label: 'שלח את המייל שוב', sendId } })
  })

  it('names what failed: the link by SMS, the reminder', async () => {
    const id = await seed({ title: 'קישור ב-SMS', status: 'sent', recipient: { name: 'גל', phone: '+972501112233' } })
    await send(id, { channel: 'sms', event: 'invitation', recipient: '+972501112233', ok: false, error: 'InforU 500' })
    await send(id, { channel: 'sms', event: 'reminder', recipient: '+972501112233', ok: false, error: 'InforU 500', sentAt: new Date(Date.now() + 1000) })
    const titles = (await reasonsOf(id)).map((r) => r.title)
    expect(titles).toEqual(['התזכורת לא נשלחה ב-SMS', 'קישור החתימה לא נשלח ב-SMS'])
  })

  it('a later successful send of the same message closes the failure', async () => {
    const id = await seed({ title: 'נשלח אחר כך', status: 'signed', recipient: { name: 'רון', email: 'ron@example.com' } })
    await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'ron@example.com', ok: false, sentAt: new Date(Date.now() - 60_000) })
    await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'ron@example.com', ok: true })
    expect(await reasonsOf(id)).toEqual([])
  })

  it('a failure someone marked as handled leaves', async () => {
    const id = await seed({ title: 'טופל ידנית', status: 'signed', recipient: { name: 'נוי', email: 'noy@example.com' } })
    await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'noy@example.com', ok: false, resolvedAt: new Date() })
    expect(await reasonsOf(id)).toEqual([])
  })

  it('a link that failed to go out no longer matters once the document is signed', async () => {
    const id = await seed({ title: 'נחתם בכל זאת', status: 'signed', recipient: { name: 'עדי', phone: '+972501112244', email: 'adi@example.com' } })
    await send(id, { channel: 'sms', event: 'invitation', recipient: '+972501112244', ok: false })
    expect(await reasonsOf(id)).toEqual([])
  })

  it('a legacy audit-only failure counts while the request is open, with a reminder as the way out', async () => {
    const open = await seed({ title: 'כשל ישן', status: 'sent', recipient: { name: 'שי', phone: '+972501112255' } })
    await audit(open, 'sms_failed', new Date(Date.now() - 2 * DAY))
    expect(topReason(await reasonsOf(open))).toMatchObject({ key: 'send_failed', title: 'קישור החתימה לא נשלח ב-SMS', explanation: 'ניסיון השליחה נכשל.', action: { kind: 'remind' } })

    const recovered = await seed({ title: 'כשל ישן שנשלח', status: 'sent' })
    await audit(recovered, 'sms_failed', new Date(Date.now() - 2 * DAY))
    await audit(recovered, 'sms_sent', new Date(Date.now() - DAY))
    expect(await reasonsOf(recovered)).toEqual([])
  })

  it('an expired link asks to be renewed, not reminded', async () => {
    const id = await seed({ title: 'פג', status: 'viewed', sentAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() - DAY) })
    const reasons = await reasonsOf(id)
    expect(reasons.map((r) => r.key)).toEqual(['link_expired'])
    expect(reasons[0]).toMatchObject({ title: 'קישור החתימה פג', action: { kind: 'renew_link', label: 'חדש קישור ושלח שוב' } })
  })

  it('viewed and stale asks for a reminder, unless one just went out', async () => {
    const stale = await seed({ title: 'תקוע', status: 'viewed', sentAt: new Date(Date.now() - 5 * DAY) })
    expect(topReason(await reasonsOf(stale))).toMatchObject({ key: 'reminder_due', title: 'נצפה ולא נחתם כבר 5 ימים', action: { kind: 'remind', label: 'שלח תזכורת' } })

    const reminded = await seed({ title: 'תקוע עם תזכורת', status: 'viewed', sentAt: new Date(Date.now() - 5 * DAY) })
    await audit(reminded, 'reminder_sent', new Date(Date.now() - DAY))
    expect(await reasonsOf(reminded)).toEqual([])
  })

  it('a document with no company is only ever findable here', async () => {
    const id = await seed({ title: 'ללא חברה', status: 'signed', companyId: null })
    expect(topReason(await reasonsOf(id))).toMatchObject({ key: 'no_company', severity: 3, action: { kind: 'link_company', label: 'שיוך לספק/לקוח' } })
  })

  it('WhatsApp: an opened share is not a failure; what the rep reported as not sent is', async () => {
    const opened = await seed({ title: 'וואטסאפ נפתח', status: 'sent', recipient: { name: 'טל', phone: '+972501112266' } })
    await send(opened, { channel: 'whatsapp', event: 'invitation', recipient: '+972501112266', ok: false, manualState: 'opened' })
    expect(await reasonsOf(opened)).toEqual([])

    const notSent = await seed({ title: 'וואטסאפ לא נשלח', status: 'sent', recipient: { name: 'טל', phone: '+972501112277' } })
    await send(notSent, { channel: 'whatsapp', event: 'invitation', recipient: '+972501112277', ok: false, manualState: 'not_sent' })
    expect(topReason(await reasonsOf(notSent))).toMatchObject({ key: 'send_failed', title: 'ההודעה ב-WhatsApp לא נשלחה', action: { kind: 'resend_message', label: 'שלח שוב ב-WhatsApp', channel: 'whatsapp' } })
  })

  it('a document simply waiting for a signature is not listed', async () => {
    const id = await seed({ title: 'ממתין כרגיל', status: 'sent', recipient: { name: 'יעל', email: 'yael@example.com' } })
    await send(id, { channel: 'email', event: 'invitation', recipient: 'yael@example.com', ok: true })
    expect(await reasonsOf(id)).toEqual([])
  })

  it('the tab lists exactly the documents that carry a reason', async () => {
    const all = await listDocuments(session, { pageSize: 100 })
    const reasons = await attentionForAgreements(orgId, all.items.map((d) => d.id))
    const expected = all.items.filter((d) => reasons.has(d.id)).map((d) => d.title).sort()
    const tab = await listDocuments(session, { filter: 'attention', pageSize: 100 })
    expect(tab.items.map((d) => d.title).sort()).toEqual(expected)
    expect(tab.total).toBe(expected.length)
    expect(expected).not.toContain('ממתין כרגיל')
    expect(expected).not.toContain('נשלח אחר כך')
    expect(expected).not.toContain('טופל ידנית')
    expect(expected).not.toContain('נחתם בכל זאת')
    expect(expected).not.toContain('וואטסאפ נפתח')
    expect(expected).toContain('כתובת שגויה')
    expect(expected).toContain('כשל ישן')
    for (const row of tab.items) expect(row.attention).not.toBeNull()
  })
})

describe('resend', () => {
  it('refuses when a later send already succeeded', async () => {
    const id = await seed({ title: 'כבר נשלח', status: 'signed', recipient: { name: 'רון', email: 'ron@example.com' } })
    const failed = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'ron@example.com', ok: false, sentAt: new Date(Date.now() - 60_000) })
    await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'ron@example.com', ok: true })
    const result = await resendFailedMessage(session, { agreementId: id, sendId: failed })
    expect(result).toMatchObject({ ok: false, state: 'already_sent' })
    expect(sent).toHaveLength(0)
  })

  it('sends the signed copy again to a corrected address, once', async () => {
    const id = await seed({ title: 'תיקון כתובת', status: 'signed', recipient: { name: 'רפי', email: 'rafi@gmail..com' } })
    const failed = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'rafi@gmail..com', ok: false, error: 'InforU StatusId=-1 mailing list failed' })

    // A still-broken address is refused before anything leaves.
    expect(await resendFailedMessage(session, { agreementId: id, sendId: failed })).toMatchObject({ ok: false, state: 'invalid_recipient' })
    expect(await resendFailedMessage(session, { agreementId: id, sendId: failed, to: 'still@bad..com' })).toMatchObject({ ok: false, state: 'invalid_recipient' })
    expect(sent).toHaveLength(0)

    const result = await resendFailedMessage(session, { agreementId: id, sendId: failed, to: 'rafi@gmail.com' })
    expect(result).toMatchObject({ ok: true, state: 'sent' })
    expect(sent).toEqual([{ channel: 'email', to: 'rafi@gmail.com', subject: 'העותק החתום שלך', text: expect.stringContaining('העותק החתום') }])

    const [recipient] = await db.select({ email: schema.recipients.email }).from(schema.recipients).where(eq(schema.recipients.agreementId, id))
    expect(recipient.email).toBe('rafi@gmail.com')
    const rows = await db.select().from(schema.messageSends).where(eq(schema.messageSends.agreementId, id))
    expect(rows).toHaveLength(2)
    const retry = rows.find((r) => r.id !== failed)!
    expect(retry).toMatchObject({ ok: true, retryOf: failed, sentBy: session.userId, recipient: 'rafi@gmail.com', event: 'signed_confirmation' })
    const [{ status }] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, id))
    expect(status).toBe('signed')
    expect(await reasonsOf(id)).toEqual([])

    // The second click: nothing goes out twice.
    expect(await resendFailedMessage(session, { agreementId: id, sendId: failed })).toMatchObject({ ok: false, state: 'already_sent' })
    expect(sent).toHaveLength(1)
  })

  it('a failed retry stays a failure, with the new error on record', async () => {
    const id = await seed({ title: 'נכשל שוב', status: 'signed', recipient: { name: 'דנה', email: 'dana@example.com' } })
    const failed = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'dana@example.com', ok: false })
    provider.ok = false
    expect(await resendFailedMessage(session, { agreementId: id, sendId: failed })).toMatchObject({ ok: false, state: 'failed' })
    expect(topReason(await reasonsOf(id))).toMatchObject({ key: 'invalid_email' })
  })

  it('refuses a canceled agreement and a message of another agreement', async () => {
    const canceled = await seed({ title: 'בוטל', status: 'canceled', recipient: { name: 'א', email: 'a@example.com' } })
    const failed = await send(canceled, { channel: 'email', event: 'signed_confirmation', recipient: 'a@example.com', ok: false })
    expect(await resendFailedMessage(session, { agreementId: canceled, sendId: failed })).toMatchObject({ ok: false, state: 'canceled' })
    const other = await seed({ title: 'אחר', status: 'signed', recipient: { name: 'ב', email: 'b@example.com' } })
    expect(await resendFailedMessage(session, { agreementId: other, sendId: failed })).toMatchObject({ ok: false, state: 'not_found' })
    expect(sent).toHaveLength(0)
  })

  it('re-issues a failed link through the ordinary resend, marked as the retry', async () => {
    const id = await seed({ title: 'קישור שנכשל', status: 'sent', recipient: { name: 'גל', phone: '+972501112288' } })
    const [recipient] = await db.select({ id: schema.recipients.id }).from(schema.recipients).where(eq(schema.recipients.agreementId, id))
    await db.insert(schema.signingTokens).values({ recipientId: recipient.id, tokenHash: hashToken('old-token'), expiresAt: new Date(Date.now() + 10 * DAY) })
    const failed = await send(id, { channel: 'sms', event: 'invitation', recipient: '+972501112288', ok: false, error: 'InforU 500' })

    const result = await resendFailedMessage(session, { agreementId: id, sendId: failed })
    expect(result).toMatchObject({ ok: true, state: 'sent' })
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('/sign/')
    const retry = (await db.select().from(schema.messageSends).where(eq(schema.messageSends.id, (result as { sendId: string }).sendId)))[0]
    expect(retry).toMatchObject({ channel: 'sms', event: 'invitation', ok: true, retryOf: failed, sentBy: session.userId })
    expect(await reasonsOf(id)).toEqual([])
  })

  it('marks a failure as handled, with the note', async () => {
    const id = await seed({ title: 'טלפנו', status: 'signed', recipient: { name: 'ג', email: 'g@example.com' } })
    const failed = await send(id, { channel: 'email', event: 'signed_confirmation', recipient: 'g@example.com', ok: false })
    expect(await resolveFailure(session, { sendId: failed, note: 'נשלח ידנית מהמייל של המשרד' })).toEqual({ ok: true })
    const [row] = await db.select().from(schema.messageSends).where(eq(schema.messageSends.id, failed))
    expect(row).toMatchObject({ resolvedBy: session.userId, resolvedNote: 'נשלח ידנית מהמייל של המשרד' })
    expect(row.resolvedAt).toBeInstanceOf(Date)
    expect(await reasonsOf(id)).toEqual([])
  })
})

describe('bulk', () => {
  it('preview counts only what can go out as it is', async () => {
    const fine = await seed({ title: 'bulk fine', status: 'signed', recipient: { name: 'א', email: 'a@example.com' } })
    await send(fine, { channel: 'email', event: 'signed_confirmation', recipient: 'a@example.com', ok: false, error: 'InforU 500' })
    const broken = await seed({ title: 'bulk broken', status: 'signed', recipient: { name: 'ב', email: 'b@gmail..com' } })
    await send(broken, { channel: 'email', event: 'signed_confirmation', recipient: 'b@gmail..com', ok: false })
    const nothing = await seed({ title: 'bulk nothing', status: 'signed', companyId: null })

    const preview = await bulkResendFailed(session, { agreementIds: [fine, broken, nothing], preview: true })
    expect(preview.eligible).toBe(1)
    expect(preview.skipped.map((s) => s.agreementId).sort()).toEqual([broken, nothing].sort())
    expect(preview.skipped.find((s) => s.agreementId === broken)?.why).toBe('יש לתקן את כתובת המייל קודם.')
    expect(sent).toHaveLength(0)

    const result = await bulkResendFailed(session, { agreementIds: [fine, broken, nothing], preview: false })
    expect(result).toMatchObject({ sent: 1, failed: 0 })
    expect(result.skipped).toHaveLength(2)
    expect(sent).toEqual([expect.objectContaining({ to: 'a@example.com' })])
  })
})

describe('registrations', () => {
  it('a registration whose company still needs matching in the CRM', () => {
    expect(registrationAttention({ meta: { linking: 'needed' } })).toMatchObject({ key: 'crm_link_needed', title: 'ההרשמה לא שויכה לחברה ב-CRM', action: { kind: 'open_registration', label: 'בדוק שיוך' } })
    expect(registrationAttention({ meta: { linking: 'done' } })).toBeNull()
    expect(registrationAttention({ meta: null })).toBeNull()
  })
})
