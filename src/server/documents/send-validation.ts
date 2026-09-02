import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { normalizeIsraeliPhone } from '@/lib/phone'
import { FIELD_LABELS } from '@/lib/fields'

/**
 * Everything that must be true before a document can be sent.
 *
 * Checked on the server, because the send endpoint is what actually acts on it —
 * a client-side check is a convenience, not a guarantee. Each blocker is a
 * sentence naming what is wrong and what to do, not a code.
 */

export type Channel = 'email' | 'sms'

export type SendSummary = {
  title: string
  /** The supplier/customer the document is filed under. */
  filedCompanyName: string | null
  recipientName: string | null
  recipientCompany: string | null
  recipientPhone: string | null
  recipientEmail: string | null
  fieldCount: number
  signatureCount: number
  /** Fields we fill in that are required and still empty. */
  blockers: string[]
  canSend: boolean
}

export async function buildSendSummary(
  agreementId: string,
  versionId: string | null,
  channels: Channel[] = [],
  /**
   * True only when a send is actually being attempted. The preview screen
   * renders before any channel is chosen, and telling someone to pick a channel
   * while both boxes are ticked in front of them is just wrong.
   */
  forSend = false,
): Promise<SendSummary> {
  const db = getDb()

  const [agreement] = await db
    .select({ title: schema.agreements.title, filedCompanyName: schema.companies.name })
    .from(schema.agreements)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)

  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreementId))
    .limit(1)

  const fields = versionId
    ? await db.select().from(schema.fields).where(eq(schema.fields.agreementVersionId, versionId))
    : []

  const signatures = fields.filter((f) => f.type === 'signature')
  const blockers: string[] = []

  // A document with no signature field is not a document to sign.
  if (signatures.length === 0) {
    blockers.push('יש להוסיף לפחות שדה חתימה אחד למסמך.')
  }

  if (!recipient?.name?.trim()) {
    blockers.push('יש להזין את שם החותם.')
  }

  // A channel is only offered if we can actually reach the signer on it.
  if (channels.includes('sms')) {
    if (!recipient?.phone) {
      blockers.push('בחרתם שליחה ב-SMS, אך לא הוזן מספר טלפון.')
    } else if (!normalizeIsraeliPhone(recipient.phone)) {
      blockers.push('מספר הטלפון של החותם אינו תקין.')
    }
  }

  if (channels.includes('email')) {
    if (!recipient?.email) {
      blockers.push('בחרתם שליחה באימייל, אך לא הוזנה כתובת אימייל.')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      blockers.push('כתובת האימייל של החותם אינה תקינה.')
    }
  }

  if (forSend && channels.length === 0) {
    blockers.push('יש לבחור לפחות ערוץ שליחה אחד.')
  }

  // Anything we promised to fill in must actually be filled in — the signer
  // cannot complete a field marked as ours.
  const ourEmpty = fields.filter(
    (f) => f.ownedBy === 'sender' && f.required && !f.value?.trim() && f.type !== 'checkbox',
  )
  for (const field of ourEmpty) {
    blockers.push(`שדה "${field.label}" מסומן כשדה שאנחנו ממלאים, אך נותר ריק.`)
  }

  // A signature the sender is supposed to provide has no way to be produced in
  // this flow, so it would silently stay blank on the signed document.
  const senderSignatures = signatures.filter((f) => f.ownedBy === 'sender')
  for (const field of senderSignatures) {
    blockers.push(
      `שדה "${field.label}" הוא חתימה שסומנה כ"אנחנו". שדה חתימה חייב להיות של החותם.`,
    )
  }

  // A field that names a page the document no longer has, or an unlabelled
  // field, would be unreachable for the signer.
  for (const field of fields) {
    if (!field.label?.trim()) {
      blockers.push(`יש שדה ${FIELD_LABELS[field.type] ?? ''} ללא שם. יש למחוק אותו או לתת לו שם.`)
    }
  }

  return {
    title: agreement?.title ?? '',
    filedCompanyName: agreement?.filedCompanyName ?? null,
    recipientName: recipient?.name ?? null,
    recipientCompany: recipient?.company ?? null,
    recipientPhone: recipient?.phone ?? null,
    recipientEmail: recipient?.email ?? null,
    fieldCount: fields.length,
    signatureCount: signatures.length,
    blockers,
    canSend: blockers.length === 0,
  }
}
