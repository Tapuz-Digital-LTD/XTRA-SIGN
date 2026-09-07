import { eq } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { buildStorageKey, sha256 } from '@/server/documents/file-validation'
import { publicBaseUrl } from '@/server/http/public-url'
import { InforuEmailProvider } from '@/server/notifications/inforu'
import { notify } from '@/server/notifications/notifications'
import { originFromSnapshot } from '@/server/self-service/agreement-skin'
import { brandFor, signedTeamEmail, signerConfirmationEmail } from '@/server/notifications/campaign-mail'
import { campaignFor } from '@/server/documents/send-agreement'
import { createTasksAfterSignature } from '@/server/follow-up/tasks'
import { cleanOverrides } from '@/lib/message-template'
import { projectNotificationSettings } from '@/server/projects/notification-settings'
import { mintAdditionalSigningLink } from '@/server/documents/send-agreement'
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
  /**
   * The raw signing token the signer arrived with, when the caller has it.
   * Only ever used to build the link in the signer's own copy email — the
   * link they already hold, pointing where their copy is.
   */
  token?: string | null
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
  await notifyAfterSigning(input.context, input.token ?? null).catch(() => {})

  // A campaign may ask for a follow-up task per signature ("הקמת מוצר
  // באתר"). Best effort, after the fact: the signature is final either way.
  await createTasksAfterSignature(input.context.agreementId).catch(() => {})

  // Nothing is pushed to the CRM here: uploading the signed PDF to Fireberry
  // is a button the user presses, never an automatic side effect of a signature.
  return { ok: true }
}

/**
 * Copy to the signer, notice to the people who asked to hear.
 *
 * Failures here are swallowed on purpose — the signature is already final, and
 * the audit trail records what was attempted.
 */
async function notifyAfterSigning(context: SigningContext, token: string | null): Promise<void> {
  const db = getDb()
  const email = new InforuEmailProvider()
  const base = publicBaseUrl()

  const [row] = await db
    .select({
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
      organizationId: schema.agreements.organizationId,
      organizationName: schema.organizations.name,
      companyId: schema.companies.id,
      companyName: schema.companies.name,
      companyTaxId: schema.companies.taxId,
      completedAt: schema.agreements.completedAt,
      mergeSnapshot: schema.agreements.mergeSnapshot,
    })
    .from(schema.agreements)
    .innerJoin(schema.users, eq(schema.users.id, schema.agreements.ownerId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.agreements.organizationId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(eq(schema.agreements.id, context.agreementId))
    .limit(1)
  if (!row) return
  const signedAt = row.completedAt ?? new Date()

  // A self-service agreement belongs to a campaign: its project's addresses
  // hear about the signature, its settings shape the signer's confirmation,
  // and its colours dress the mail.
  const origin = originFromSnapshot(row.mergeSnapshot)
  const project = origin
    ? (
        await db
          .select({ id: schema.groups.id, name: schema.groups.name, notifyEmails: schema.groups.notifyEmails })
          .from(schema.groups)
          .where(eq(schema.groups.id, origin.projectId))
          .limit(1)
      )[0]
    : null
  const extraEmails = Array.isArray(project?.notifyEmails)
    ? (project!.notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string')
    : []
  const settings = project ? await projectNotificationSettings(project.id) : null
  const brand = await brandFor({ organizationId: row.organizationId, skin: origin?.skin.key ?? null })

  // The team: in-app first — the one channel that does not depend on a third
  // party — then the full email to whoever asked to hear.
  const teamMail = await signedTeamEmail({
    projectName: project?.name ?? null,
    documentName: context.title,
    agreementId: context.agreementId,
    companyId: row.companyId,
    companyName: row.companyName,
    taxId: row.companyTaxId,
    signerName: context.recipientName,
    signedAt,
    brand,
  })
  await notify({
    organizationId: row.organizationId,
    type: 'signed',
    agreementId: context.agreementId,
    title: `${context.recipientName} חתם על "${context.title}"`,
    body: row.companyName,
    extraEmails,
    projectId: project?.id ?? null,
    email: teamMail,
  })

  // The signer's own confirmation: generic words, a button scoped to this
  // one document, the campaign's colours. Off only when the project says so.
  const signerCopy = settings?.signerCopy ?? { enabled: true, replyTo: null, senderName: null, note: null, attachPdf: false }
  if (context.recipientEmail && signerCopy.enabled) {
    const downloadToken = token ?? (await mintAdditionalSigningLink(context.recipientId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))).token
    const mail = await signerConfirmationEmail({
      vars: {
        document_name: context.title,
        signer_name: context.recipientName,
        signed_document_link: `${base}/api/sign/${downloadToken}/download`,
        organization_name: row.organizationName,
        signed_at: formatSigningDate(signedAt),
        company_name: row.companyName,
        campaign_name: project?.name ?? null,
        email: context.recipientEmail,
        phone: context.recipientPhone,
      },
      brand,
      note: signerCopy.note,
      template: project ? cleanOverrides((await campaignFor(context.agreementId))?.messageOverrides).signed_confirmation : null,
    })
    let attachments: { name: string; contentType: string; data: Buffer }[] | undefined
    if (signerCopy.attachPdf) {
      const [version] = await db
        .select({ signedFileKey: schema.agreementVersions.signedFileKey })
        .from(schema.agreementVersions)
        .where(eq(schema.agreementVersions.id, context.versionId))
        .limit(1)
      if (version?.signedFileKey) {
        attachments = [{ name: `${context.title}.pdf`, contentType: 'application/pdf', data: await getStorage().get(version.signedFileKey) }].filter((a) => a.data.length > 0)
      }
    }
    const result = await email.send({
      to: context.recipientEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      recipientName: context.recipientName,
      replyTo: signerCopy.replyTo ?? undefined,
      fromName: signerCopy.senderName ?? undefined,
      attachments,
    })
    try {
      await db.insert(schema.messageSends).values({
        organizationId: row.organizationId,
        groupId: project?.id ?? null,
        agreementId: context.agreementId,
        channel: 'email',
        event: 'signed_confirmation',
        recipient: context.recipientEmail,
        subject: mail.subject,
        body: mail.text,
        variables: { signer_name: context.recipientName, document_name: context.title, campaign_name: project?.name ?? null },
        providerMessageId: result.providerMessageId,
        ok: result.ok,
        error: result.ok ? null : result.error,
      })
    } catch (error) {
      log.warn('message snapshot failed', { agreementId: context.agreementId, error: String(error) })
    }
    // Recorded, so a thank-you page can say "a copy was emailed" only when
    // one actually was — and a failure is visible, never fatal.
    await db.insert(schema.auditEvents).values({
      agreementId: context.agreementId,
      recipientId: context.recipientId,
      type: result.ok ? AUDIT_EVENTS.EMAIL_SENT : AUDIT_EVENTS.EMAIL_FAILED,
      actor: 'system',
      metadata: { purpose: 'signed_copy', ...(result.ok ? {} : { error: result.error }) },
    })
  }

  // The owner's personal note is for documents a person sent. A campaign's
  // people are on the notification settings above.
  if (!origin && row.ownerEmail) {
    await email.send({ to: row.ownerEmail, subject: teamMail.subject, text: teamMail.text, html: teamMail.html, recipientName: row.ownerName })
  }
}

/** dd/mm/yyyy on the Israel calendar — the date a person here would write. */
function formatSigningDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
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
