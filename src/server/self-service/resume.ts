import { and, eq } from 'drizzle-orm'
import { maskPhone } from '@/lib/phone'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { mintAdditionalSigningLink, ttlDaysFor } from '@/server/documents/send-agreement'
import { log } from '@/server/log'
import type { SelfServiceProject } from '@/server/projects/self-service'
import { sendOtp } from '@/server/signing/otp'
import { resolveSigningToken, resolveTokenForRenewal } from '@/server/signing/session'

/**
 * "המשך חתימה" — picking a registration up again after a link or a code
 * ran out. The agreement is the same one; only the token is new, with the
 * campaign's lifetime, and the phone code is sent again. Signed already →
 * a fresh download link instead. Nothing here creates a company, a
 * registration or a second agreement.
 *
 * Allowed while the campaign takes registrations, and after it ends as long
 * as the campaign lets those who registered finish (the default).
 */

export type ResumeResult =
  | { ok: true; kind: 'ready'; token: string; maskedPhone: string | null }
  | { ok: true; kind: 'already_signed'; token: string }
  | { ok: false; message: string; closed?: boolean }

async function agreementForRegistration(registrationId: string, projectId: string) {
  const [lead] = await getDb()
    .select({ agreementId: schema.projectLeads.agreementId })
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.id, registrationId), eq(schema.projectLeads.groupId, projectId)))
    .limit(1)
  return lead?.agreementId ?? null
}

export async function resumeSigning(project: SelfServiceProject, by: { token?: string; registrationId?: string }): Promise<ResumeResult> {
  const db = getDb()
  let agreementId: string | null = null
  if (by.token) {
    const live = await resolveSigningToken(by.token)
    const any = live ?? (await resolveTokenForRenewal(by.token))
    agreementId = any?.agreementId ?? null
  } else if (by.registrationId) {
    agreementId = await agreementForRegistration(by.registrationId, project.groupId)
  }
  if (!agreementId) return { ok: false, message: 'לא מצאנו את ההרשמה. אפשר להירשם מחדש מעמוד הקמפיין.' }

  const [agreement] = await db
    .select({ id: schema.agreements.id, status: schema.agreements.status, organizationId: schema.agreements.organizationId })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)
  if (!agreement || agreement.organizationId !== project.organizationId) return { ok: false, message: 'לא מצאנו את ההרשמה.' }
  // The agreement must belong to this campaign — a link from another campaign's mail does not open here.
  const [lead] = await db.select({ id: schema.projectLeads.id }).from(schema.projectLeads).where(and(eq(schema.projectLeads.agreementId, agreement.id), eq(schema.projectLeads.groupId, project.groupId))).limit(1)
  if (!lead) return { ok: false, message: 'לא מצאנו את ההרשמה בקמפיין הזה.' }

  const [recipient] = await db.select({ id: schema.recipients.id, phone: schema.recipients.phone }).from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id)).limit(1)
  if (!recipient) return { ok: false, message: 'לא מצאנו את פרטי החותם.' }

  const ttlDays = await ttlDaysFor(agreement.id)
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  if (agreement.status === 'signed') {
    const minted = await mintAdditionalSigningLink(recipient.id, expiresAt)
    return { ok: true, kind: 'already_signed', token: minted.token }
  }
  if (!['sent', 'viewed', 'expired'].includes(agreement.status)) return { ok: false, message: 'ההסכם הזה כבר אינו פתוח לחתימה.' }
  if (!project.registrationsOpen && !project.completionAllowed) return { ok: false, closed: true, message: 'ההרשמה לקמפיין הסתיימה ולא ניתן להשלים חתימה.' }

  const minted = await mintAdditionalSigningLink(recipient.id, expiresAt)
  if (agreement.status === 'expired') await db.update(schema.agreements).set({ status: 'sent', expiresAt }).where(eq(schema.agreements.id, agreement.id))
  await db.insert(schema.auditEvents).values({ agreementId: agreement.id, recipientId: recipient.id, type: AUDIT_EVENTS.LINK_RENEWED, actor: 'signer', metadata: { by: by.token ? 'expired_link' : 'continue_page', ttlDays } })

  const context = await resolveSigningToken(minted.token)
  let maskedPhone: string | null = null
  if (context) {
    const otp = await sendOtp(context).catch((error) => {
      log.warn('resume: otp not sent', { agreementId: agreement.id, error: String(error) })
      return { ok: false as const, message: '' }
    })
    if (!otp.ok) log.warn('resume: otp refused', { agreementId: agreement.id })
    maskedPhone = maskPhone(recipient.phone) ?? null
  }
  return { ok: true, kind: 'ready', token: minted.token, maskedPhone }
}
