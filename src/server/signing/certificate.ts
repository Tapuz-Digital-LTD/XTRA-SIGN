import { asc, eq } from 'drizzle-orm'
import { maskPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { buildCertificatePdf } from './pdf'

/**
 * Builds the audit certificate for a signed agreement, on demand.
 *
 * Internal only — it is produced from the stored evidence each time it is asked
 * for, so it always reflects the current audit trail, and it carries the
 * SHA-256 of the clean signed document rather than being baked into it. A
 * document that is not signed has no certificate.
 */
export type CertificateResult =
  | { ok: true; pdf: Buffer; title: string }
  | { ok: false; message: string }

export async function buildAgreementCertificate(input: {
  session: StaffSession
  agreementId: string
}): Promise<CertificateResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status !== 'signed' || !agreement.currentVersionId) {
    return { ok: false, message: 'אין אישור חתימה למסמך שאינו חתום.' }
  }

  const db = getDb()

  const [version] = await db
    .select({ signedHash: schema.agreementVersions.signedHash })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, agreement.currentVersionId))
    .limit(1)

  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  const [signature] = await db
    .select({ signedAt: schema.signatures.signedAt })
    .from(schema.signatures)
    .where(eq(schema.signatures.recipientId, recipient?.id ?? ''))
    .limit(1)

  const events = await db
    .select({ type: schema.auditEvents.type, createdAt: schema.auditEvents.createdAt })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.agreementId, agreement.id))
    .orderBy(asc(schema.auditEvents.createdAt))

  const pdf = await buildCertificatePdf({
    agreementId: agreement.id,
    title: agreement.title,
    signerName: recipient?.name ?? '—',
    signerEmail: recipient?.email ?? null,
    signerPhoneMasked: maskPhone(recipient?.phone ?? null),
    verificationMethod: recipient?.verifiedVia === 'sms_otp' ? 'קוד חד-פעמי ב-SMS' : 'לא בוצע',
    verifiedAt: recipient?.verifiedAt ?? null,
    signedAt: signature?.signedAt ?? recipient?.signedAt ?? new Date(),
    signedHash: version?.signedHash ?? '—',
    events: events.map((e) => ({ type: e.type, at: e.createdAt })),
  })

  return { ok: true, pdf, title: agreement.title }
}
