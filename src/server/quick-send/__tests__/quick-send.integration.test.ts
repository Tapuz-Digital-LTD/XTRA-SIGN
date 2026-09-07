import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createComposedDocument } from '@/server/documents/compose'
import { loadFields, saveFields } from '@/server/documents/save-fields'
import { listGroups } from '@/server/groups/groups'
import { DIRECT_SIGNING_KEY, listAudience } from '@/server/invitations/invitations'
import { createTemplateFromAgreement } from '@/server/templates/templates'
import { quickSend } from '../quick-send'

const op = () => `op-${crypto.randomUUID()}`

/**
 * "שלח מסמך לחתימה" to someone the system does not know: a document, a
 * recipient, a tracked row under the internal context — and no supplier,
 * no customer, no visible campaign. Fields the office would fill are handed
 * to the signer when they are empty.
 */

const db = getDb()
let session: StaffSession
let orgId: string
let templateId: string
let companyId: string

const SIGNATURE = { id: crypto.randomUUID(), type: 'signature', label: 'חתימה', ownedBy: 'signer', required: true, page: 1, x: 0.6, y: 0.8, width: 0.28, height: 0.06, value: null, options: null }
const TAX_ID = { id: crypto.randomUUID(), type: 'text', label: 'ח.פ.', ownedBy: 'sender', required: true, page: 1, x: 0.1, y: 0.2, width: 0.24, height: 0.035, value: null, options: null }

beforeAll(async () => {
  const [org] = await db.insert(schema.organizations).values({ name: `Quick ${crypto.randomUUID().slice(0, 8)}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  const [user] = await db.insert(schema.users).values({ organizationId: orgId, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: 'Rep', phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isAdmin: true }).returning({ id: schema.users.id })
  session = { userId: user.id, organizationId: orgId, email: 'rep@xtra.test', name: 'Rep', isAdmin: true }
  const [company] = await db.insert(schema.companies).values({ organizationId: orgId, kind: 'supplier', name: 'ספק קיים', contactName: 'דנה', contactPhone: '+972500000333', contactEmail: 'dana@example.com', source: 'xtra' }).returning({ id: schema.companies.id })
  companyId = company.id
  const composed = await createComposedDocument({ session, title: 'הסכם', text: '# תנאים\nהספק מתחייב.', companyId })
  if (!composed.ok) throw new Error(composed.message)
  const saved = await saveFields({ session, agreementId: composed.agreementId, fields: [SIGNATURE, TAX_ID] })
  if (!saved.ok) throw new Error(saved.message)
  const template = await createTemplateFromAgreement({ session, agreementId: composed.agreementId, name: 'תבנית' })
  if (!template.ok) throw new Error(template.message)
  templateId = template.templateId
})

describe('quick send', () => {
  it('sends to a person not in the system: no company, a tracked row, the empty office field handed to the signer', async () => {
    const companiesBefore = (await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.organizationId, orgId))).length
    const result = await quickSend(session, { operationId: op(), recipient: { name: 'יוסי חדש', phone: '050-000-0444', kind: 'supplier' }, templateId, channel: 'sms' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.agreementId))
    expect(agreement.companyId).toBeNull()
    expect(agreement.status).toBe('sent')
    const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id))
    expect(recipient.name).toBe('יוסי חדש')
    expect(recipient.phone).toBe('+972500000444')

    const [lead] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, result.leadId))
    expect(lead.agreementId).toBe(agreement.id)
    expect(lead.companyId).toBeNull()
    expect(lead.kind).toBe('supplier')
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, lead.groupId))
    expect(group.systemKey).toBe(DIRECT_SIGNING_KEY)

    const sends = await db.select().from(schema.messageSends).where(eq(schema.messageSends.agreementId, agreement.id))
    expect(sends.length).toBeGreaterThan(0)
    expect(sends.every((s) => s.leadId === result.leadId)).toBe(true)

    const fields = await loadFields(agreement.currentVersionId!)
    const taxField = fields.find((f) => f.label === 'ח.פ.')
    expect(taxField?.ownedBy).toBe('signer')
    expect(taxField?.required).toBe(true)

    const companiesAfter = (await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.organizationId, orgId))).length
    expect(companiesAfter).toBe(companiesBefore)
  })

  it('the internal context is not a campaign anyone sees, but its people are tracked', async () => {
    const groups = await listGroups(session)
    expect(groups.some((g) => g.name === 'חתימות ישירות')).toBe(false)
    const [direct] = await db.select({ id: schema.groups.id }).from(schema.groups).where(and(eq(schema.groups.organizationId, orgId), eq(schema.groups.systemKey, DIRECT_SIGNING_KEY)))
    const audience = await listAudience(session, direct.id)
    expect(audience.rows.some((r) => r.name === 'יוסי חדש' && r.status === 'awaiting_signature')).toBe(true)
  })

  it('an existing supplier gets a document filed under them', async () => {
    const result = await quickSend(session, { operationId: op(), recipient: { companyId }, templateId, channel: 'email' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, result.agreementId))
    expect(agreement.companyId).toBe(companyId)
    const [lead] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, result.leadId))
    expect(lead.companyId).toBe(companyId)
  })

  it('WhatsApp mints the link, marks the document sent, and records the share as opened — never as delivered', async () => {
    const result = await quickSend(session, { operationId: op(), recipient: { name: 'רונית', phone: '0500000555', kind: 'customer' }, templateId, channel: 'whatsapp' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.whatsapp?.url).toMatch(/^https:\/\/wa\.me\/972500000555\?text=/)
    expect(result.whatsapp?.text).toMatch(/\/sign\//)
    const [send] = await db.select().from(schema.messageSends).where(eq(schema.messageSends.id, result.whatsapp!.sendId))
    expect(send.channel).toBe('whatsapp')
    expect(send.ok).toBe(false)
    expect(send.manualState).toBe('opened')
    const [agreement] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, result.agreementId))
    expect(agreement.status).toBe('sent')
  })

  it('refuses a channel the person cannot receive', async () => {
    const result = await quickSend(session, { operationId: op(), recipient: { name: 'בלי מייל', phone: '0500000666', kind: 'supplier' }, templateId, channel: 'email' })
    expect(result.ok).toBe(false)
  })

  it('the same operation twice makes one document and replays the first result', async () => {
    const operationId = op()
    const agreementsBefore = (await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).length
    const first = await quickSend(session, { operationId, recipient: { name: 'כפול', phone: '0500000777', kind: 'supplier' }, templateId, channel: 'sms' })
    const second = await quickSend(session, { operationId, recipient: { name: 'כפול', phone: '0500000777', kind: 'supplier' }, templateId, channel: 'sms' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.agreementId).toBe(first.agreementId)
    expect(second.leadId).toBe(first.leadId)
    expect(second.replayed).toBe(true)
    const agreementsAfter = (await db.select({ id: schema.agreements.id }).from(schema.agreements).where(eq(schema.agreements.organizationId, orgId))).length
    expect(agreementsAfter - agreementsBefore).toBe(1)
    const sends = await db.select().from(schema.messageSends).where(eq(schema.messageSends.leadId, first.leadId))
    expect(sends.filter((x) => x.channel === 'sms')).toHaveLength(1)
  })

  it('two clicks at once make one document; the second waits and gets the same result', async () => {
    const operationId = op()
    const input = { operationId, recipient: { name: 'מקביל', phone: '0500000888', kind: 'supplier' as const }, templateId, channel: 'sms' as const }
    const [a, b] = await Promise.all([quickSend(session, input), quickSend(session, input)])
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.agreementId).toBe(b.agreementId)
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1)
    const leads = await db.select({ id: schema.projectLeads.id }).from(schema.projectLeads).where(eq(schema.projectLeads.agreementId, a.agreementId))
    expect(leads).toHaveLength(1)
  })

  it('a retry after a failed attempt reuses the claim instead of leaving a dead row', async () => {
    const operationId = op()
    const broken = await quickSend(session, { operationId, recipient: { name: 'נסיון', phone: '0500000999', kind: 'supplier' }, templateId: crypto.randomUUID(), channel: 'sms' })
    expect(broken.ok).toBe(false)
    const rows = await db.select().from(schema.projectLeads).where(and(eq(schema.projectLeads.organizationId, orgId), eq(schema.projectLeads.phone, '+972500000999')))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    const again = await quickSend(session, { operationId, recipient: { name: 'נסיון', phone: '0500000999', kind: 'supplier' }, templateId, channel: 'sms' })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.leadId).toBe(rows[0].id)
    expect(again.replayed).toBe(false)
    const after = await db.select().from(schema.projectLeads).where(and(eq(schema.projectLeads.organizationId, orgId), eq(schema.projectLeads.phone, '+972500000999')))
    expect(after).toHaveLength(1)
    expect(after[0].agreementId).toBe(again.agreementId)
  })

  it('the same phone with a different operation is a different document — never merged by phone', async () => {
    const one = await quickSend(session, { operationId: op(), recipient: { name: 'עסק א', phone: '0500001111', kind: 'supplier' }, templateId, channel: 'sms' })
    const two = await quickSend(session, { operationId: op(), recipient: { name: 'עסק ב', phone: '0500001111', kind: 'customer' }, templateId, channel: 'sms' })
    expect(one.ok && two.ok && one.agreementId !== two.agreementId).toBe(true)
  })
})
