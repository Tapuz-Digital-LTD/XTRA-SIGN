import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { buildStorageKey, sha256 } from '@/server/documents/file-validation'
import { InforuEmailProvider } from '@/server/notifications/inforu'
import { getStorage } from '@/server/storage/blob'
import { buildSignedPdf } from './pdf'
import type { SigningContext } from './session'

/**
 * Completes a signature.
 *
 * Everything that makes the document final happens in one transaction after the
 * PDF exists: a half-completed agreement with no signed file, or a signed file
 * with no status change, are both worse than a clean failure.
 */

const MAX_SIGNATURE_BYTES = 512 * 1024

export type CompleteResult = { ok: true } | { ok: false; message: string }

export async function completeSigning(input: {
  context: SigningContext
  /** PNG data URL from the signature pad. */
  signatureDataUrl: string
  signatureMethod: 'drawn' | 'typed'
  consentText: string
  ip?: string | null
  userAgent?: string | null
}): Promise<CompleteResult> {
  const db = getDb()

  const signatureImage = decodePng(input.signatureDataUrl)
  if (!signatureImage) return { ok: false, message: 'החתימה לא נקלטה. נסו שוב.' }
  if (signatureImage.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, message: 'החתימה גדולה מדי. נסו שוב.' }
  }

  const [version] = await db
    .select()
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, input.context.versionId))
    .limit(1)

  if (!version?.renderedFileKey) return { ok: false, message: 'המסמך אינו זמין לחתימה.' }

  const fields = await db
    .select()
    .from(schema.fields)
    .where(eq(schema.fields.agreementVersionId, version.id))

  // Nothing is signed until every required field actually has a value.
  const missing = fields.filter(
    (f) => f.required && f.type !== 'signature' && !f.autoFill && !f.value?.trim(),
  )
  if (missing.length > 0) {
    return { ok: false, message: `נותרו ${missing.length} שדות למילוי.` }
  }

  const pages = await db
    .select()
    .from(schema.documentPages)
    .where(eq(schema.documentPages.agreementVersionId, version.id))

  const storage = getStorage()
  const renderedPdf = await storage.get(version.renderedFileKey)
  const signedAt = new Date()

  // The clean signed document only: original + field values + signature. Every
  // piece of evidence — ids, hashes, timestamps, the audit history — is kept out
  // of this file and lives in the separate certificate the certificate route
  // builds on demand for internal use.
  const signedPdf = await buildSignedPdf({
    renderedPdf,
    fields: fields.map((f) => ({
      type: f.type,
      label: f.label,
      // A date set to fill automatically is stamped with the signing date.
      value: f.autoFill && f.type === 'date' ? formatSigningDate(signedAt) : f.value,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
    })),
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      widthPt: p.widthPt,
      heightPt: p.heightPt,
    })),
    signatureImage,
  })

  const signedKey = buildStorageKey({
    organizationId: input.context.organizationId,
    agreementId: input.context.agreementId,
    purpose: 'signed',
    ext: 'pdf',
  })
  const signatureKey = buildStorageKey({
    organizationId: input.context.organizationId,
    agreementId: input.context.agreementId,
    purpose: 'signature',
    ext: 'png',
  })

  // Stored before the transaction: a row pointing at a missing object is worse
  // than an orphaned object.
  await storage.put(signedKey, signedPdf, 'application/pdf')
  await storage.put(signatureKey, signatureImage, 'image/png')

  const signedHash = sha256(signedPdf)

  await db.transaction(async (tx) => {
    await tx
      .update(schema.agreementVersions)
      .set({ signedFileKey: signedKey, signedHash })
      .where(eq(schema.agreementVersions.id, version.id))

    await tx.insert(schema.signatures).values({
      recipientId: input.context.recipientId,
      agreementVersionId: version.id,
      imageKey: signatureKey,
      method: input.signatureMethod,
      consentText: input.consentText,
      signedAt,
    })

    await tx
      .update(schema.recipients)
      .set({ signedAt })
      .where(eq(schema.recipients.id, input.context.recipientId))

    // The status change is what freezes the document: every editing path checks
    // for 'draft', and the signing token stops resolving once it leaves an open
    // status.
    await tx
      .update(schema.agreements)
      .set({ status: 'signed', completedAt: signedAt })
      .where(eq(schema.agreements.id, input.context.agreementId))

    await tx.insert(schema.auditEvents).values([
      {
        agreementId: input.context.agreementId,
        recipientId: input.context.recipientId,
        type: AUDIT_EVENTS.SIGNATURE_APPLIED,
        actor: 'signer',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: { method: input.signatureMethod },
      },
      {
        agreementId: input.context.agreementId,
        recipientId: input.context.recipientId,
        type: AUDIT_EVENTS.COMPLETED,
        actor: 'signer',
        ip: input.ip ?? null,
        metadata: { signedHash },
      },
    ])
  })

  // Notifications last, and never inside the transaction: a mail failure must
  // not roll back a completed signature.
  await notifyAfterSigning(input.context, signedPdf).catch(() => {})

  return { ok: true }
}

/**
 * Copy to the signer, notice to the owner.
 *
 * Failures here are swallowed on purpose — the signature is already final, and
 * the audit trail records what was attempted.
 */
async function notifyAfterSigning(context: SigningContext, signedPdf: Buffer): Promise<void> {
  const db = getDb()
  const email = new InforuEmailProvider()

  const [owner] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.agreements)
    .innerJoin(schema.users, eq(schema.users.id, schema.agreements.ownerId))
    .where(eq(schema.agreements.id, context.agreementId))
    .limit(1)

  if (context.recipientEmail) {
    await email.send({
      to: context.recipientEmail,
      subject: `המסמך "${context.title}" נחתם`,
      text: `המסמך נחתם בהצלחה. ניתן להוריד עותק מהקישור שנשלח אליך.`,
      recipientName: context.recipientName,
    })
  }

  if (owner?.email) {
    const base = (process.env.SIGN_PUBLIC_URL ?? '').replace(/\/+$/, '')
    await email.send({
      to: owner.email,
      subject: 'המסמך נחתם',
      text: `${context.recipientName} חתם על "${context.title}". צפייה במסמך: ${base}/documents/${context.agreementId}`,
      recipientName: owner.name,
    })
  }

  void signedPdf
}

/** dd/mm/yyyy in the local Israel calendar sense — the date a person would write. */
function formatSigningDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${d}/${m}/${date.getUTCFullYear()}`
}

/**
 * Decodes the signature pad's data URL.
 *
 * The prefix is checked rather than trusted: an arbitrary base64 blob labelled
 * as a PNG would be stored and later embedded into a signed document.
 */
function decodePng(dataUrl: string): Buffer | null {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match) return null

  try {
    const buffer = Buffer.from(match[1], 'base64')
    // Real PNG magic, not just a matching prefix.
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return buffer.subarray(0, 8).equals(magic) ? buffer : null
  } catch {
    return null
  }
}
