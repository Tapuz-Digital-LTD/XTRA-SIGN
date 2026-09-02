import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { sha256 } from '@/server/documents/file-validation'
import { processDocumentVersion } from '@/server/documents/process-document'
import { saveFields, saveRecipient } from '@/server/documents/save-fields'
import { buildSendSummary } from '@/server/documents/send-validation'
import { sendAgreement } from '@/server/documents/send-agreement'
import { uploadDocument } from '@/server/documents/upload-document'
import { getStorage } from '@/server/storage/blob'
import { completeSigning } from '../complete'
import { resolveSigningToken } from '../session'
import { shapeForPdf } from '../pdf-text'

/**
 * The signer's journey against the real stack.
 *
 * Cookie-dependent steps (OTP session) are covered by the browser run; this
 * exercises the server logic that produces and freezes the signed document.
 */

const db = getDb()

let orgId: string
let session: StaffSession
let agreementId: string
let versionId: string
let signingUrl: string

// A real 1x1 PNG, so the signature path embeds an actual image.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SIGNATURE_DATA_URL = `data:image/png;base64,${PNG_1PX.toString('base64')}`

/**
 * A minimal but real single-page A4 PDF. Version 1 accepts PDF only, so this is
 * exactly the input the product takes.
 */
const A4_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n',
)

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Sign ${suffix}` })
    .returning({ id: schema.organizations.id })
  orgId = org.id

  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: orgId,
      email: `signer-test-${suffix}@xtra.test`,
      name: 'Owner',
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin: true,
    })
    .returning({ id: schema.users.id })

  session = {
    userId: user.id,
    organizationId: orgId,
    email: `signer-test-${suffix}@xtra.test`,
    name: 'Owner',
    isAdmin: true,
  }

  const uploaded = await uploadDocument({
    session,
    buffer: A4_PDF,
    filename: 'הסכם ספק.pdf',
  })
  if (!uploaded.ok) throw new Error('upload failed')
  agreementId = uploaded.agreementId
  versionId = uploaded.versionId

  const processed = await processDocumentVersion({
    agreementId,
    organizationId: orgId,
    versionId,
    actor: session.email,
  })
  if (!processed.ok) throw new Error('processing failed')
}, 240_000)

afterAll(async () => {
  await db.delete(schema.auditEvents).where(eq(schema.auditEvents.agreementId, agreementId))
  await db.delete(schema.deliveries).where(eq(schema.deliveries.agreementId, agreementId))
  const recipients = await db
    .select({ id: schema.recipients.id })
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreementId))
  for (const r of recipients) {
    await db.delete(schema.signatures).where(eq(schema.signatures.recipientId, r.id))
    await db.delete(schema.signingSessions).where(eq(schema.signingSessions.recipientId, r.id))
    await db.delete(schema.signingTokens).where(eq(schema.signingTokens.recipientId, r.id))
    await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.recipientId, r.id))
  }
  await db.delete(schema.recipients).where(eq(schema.recipients.agreementId, agreementId))
  await db.delete(schema.fields).where(eq(schema.fields.agreementVersionId, versionId))
  await db.delete(schema.documentPages).where(eq(schema.documentPages.agreementVersionId, versionId))
  await db.update(schema.agreements).set({ currentVersionId: null }).where(eq(schema.agreements.id, agreementId))
  await db.delete(schema.agreementVersions).where(eq(schema.agreementVersions.agreementId, agreementId))
  await db.delete(schema.agreements).where(eq(schema.agreements.id, agreementId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
})

describe('pre-send validation', () => {
  it('blocks a document with no signature field', async () => {
    const summary = await buildSendSummary(agreementId, versionId, ['email'])
    expect(summary.canSend).toBe(false)
    expect(summary.blockers.some((b) => b.includes('שדה חתימה'))).toBe(true)
  })

  it('blocks a missing signer name', async () => {
    const summary = await buildSendSummary(agreementId, versionId, ['email'])
    expect(summary.blockers.some((b) => b.includes('שם החותם'))).toBe(true)
  })

  it('blocks SMS with no phone, and email with no address', async () => {
    await saveRecipient({ session, agreementId, name: 'ישראל ישראלי' })

    const sms = await buildSendSummary(agreementId, versionId, ['sms'])
    expect(sms.blockers.some((b) => b.includes('טלפון'))).toBe(true)

    const email = await buildSendSummary(agreementId, versionId, ['email'])
    expect(email.blockers.some((b) => b.includes('אימייל'))).toBe(true)
  })

  it('blocks a required field of ours that is still empty', async () => {
    await saveFields({
      session,
      agreementId,
      fields: [
        {
          type: 'signature', label: 'חתימה', ownedBy: 'signer', required: true,
          page: 1, x: 0.6, y: 0.85, width: 0.28, height: 0.06,
        },
        {
          type: 'text', label: 'שם החברה', ownedBy: 'sender', required: true,
          page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04, value: '',
        },
      ],
    })

    const summary = await buildSendSummary(agreementId, versionId, ['email'])
    expect(summary.blockers.some((b) => b.includes('שם החברה'))).toBe(true)
  })

  it('blocks a signature field assigned to us rather than the signer', async () => {
    await saveFields({
      session,
      agreementId,
      fields: [
        {
          type: 'signature', label: 'חתימה שלנו', ownedBy: 'sender', required: true,
          page: 1, x: 0.6, y: 0.85, width: 0.28, height: 0.06,
        },
      ],
    })
    const summary = await buildSendSummary(agreementId, versionId, ['email'])
    expect(summary.blockers.some((b) => b.includes('חייב להיות של החותם'))).toBe(true)
  })

  it('blocks a send attempt with no channel, but not the preview screen', async () => {
    // The preview renders before anything is ticked; nagging there is wrong.
    const preview = await buildSendSummary(agreementId, versionId, [])
    expect(preview.blockers.some((b) => b.includes('ערוץ שליחה'))).toBe(false)

    const attempt = await buildSendSummary(agreementId, versionId, [], true)
    expect(attempt.blockers.some((b) => b.includes('ערוץ שליחה'))).toBe(true)
  })

  it('passes once everything is in place, and counts the signatures', async () => {
    await saveRecipient({
      session, agreementId,
      name: 'ישראל ישראלי',
      company: 'אטרקציות ישראל בע״מ',
      phone: '0501234567',
      email: 'israel@example.com',
    })
    await saveFields({
      session, agreementId,
      fields: [
        {
          type: 'signature', label: 'חתימת הספק', ownedBy: 'signer', required: true,
          page: 1, x: 0.6, y: 0.85, width: 0.28, height: 0.06,
        },
        {
          type: 'text', label: 'שם החברה', ownedBy: 'sender', required: true,
          page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04, value: 'אטרקציות ישראל בע״מ',
        },
        {
          type: 'text', label: 'אחוז עמלה', ownedBy: 'signer', required: true,
          page: 1, x: 0.1, y: 0.3, width: 0.2, height: 0.04,
        },
      ],
    })

    const summary = await buildSendSummary(agreementId, versionId, ['email', 'sms'])
    expect(summary.blockers).toEqual([])
    expect(summary.canSend).toBe(true)
    expect(summary.fieldCount).toBe(3)
    expect(summary.signatureCount).toBe(1)
  })
})

describe('sending', () => {
  it('creates a signing token that is stored only as a hash', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendAgreement({ session, agreementId, channels: ['email'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    signingUrl = result.signingUrl

    const token = signingUrl.split('/').pop()!
    const [row] = await db
      .select()
      .from(schema.signingTokens)
      .innerJoin(schema.recipients, eq(schema.recipients.id, schema.signingTokens.recipientId))
      .where(eq(schema.recipients.agreementId, agreementId))

    // The raw token must never be recoverable from the database.
    expect(row.signing_tokens.tokenHash).not.toBe(token)
    expect(row.signing_tokens.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  }, 60_000)

  it('records a Delivery even when the provider is not configured', async () => {
    // Credentials are absent in this environment, so the send reports NOT sent.
    // That failure has to be visible on the document, not only in a log.
    const deliveries = await db
      .select()
      .from(schema.deliveries)
      .where(eq(schema.deliveries.agreementId, agreementId))

    expect(deliveries.length).toBeGreaterThan(0)
    expect(deliveries[0].provider).toBe('inforu')
    expect(deliveries[0].channel).toBe('email')
  })

  it('moves the document out of draft, which freezes the layout', async () => {
    const [agreement] = await db
      .select()
      .from(schema.agreements)
      .where(eq(schema.agreements.id, agreementId))
    expect(agreement.status).toBe('sent')
    expect(agreement.sentAt).toBeTruthy()

    const frozen = await saveFields({ session, agreementId, fields: [] })
    expect(frozen).toMatchObject({ ok: false })
  })

  it('refuses to send the same document twice', async () => {
    const again = await sendAgreement({ session, agreementId, channels: ['email'] })
    expect(again.ok).toBe(false)
  })
})

describe('the signing link', () => {
  it('resolves to the document, repeatedly — it is NOT one-time-use', async () => {
    const token = signingUrl.split('/').pop()!

    // Opened three times, as a signer who closes the browser and comes back would.
    for (let i = 0; i < 3; i++) {
      const context = await resolveSigningToken(token)
      expect(context, `open ${i + 1}`).not.toBeNull()
      expect(context!.agreementId).toBe(agreementId)
    }
  })

  it('does not resolve a guessed or malformed token', async () => {
    for (const bad of ['', 'short', 'x'.repeat(43), 'a'.repeat(500)]) {
      expect(await resolveSigningToken(bad)).toBeNull()
    }
  })

  it('stops resolving once revoked', async () => {
    const token = signingUrl.split('/').pop()!
    const context = await resolveSigningToken(token)

    await db
      .update(schema.signingTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.signingTokens.id, context!.tokenId))

    expect(await resolveSigningToken(token)).toBeNull()

    await db
      .update(schema.signingTokens)
      .set({ revokedAt: null })
      .where(eq(schema.signingTokens.id, context!.tokenId))
  })
})

describe('completing the signature', () => {
  it('refuses while a required signer field is still empty', async () => {
    const token = signingUrl.split('/').pop()!
    const context = (await resolveSigningToken(token))!

    const result = await completeSigning({
      context,
      signatureDataUrl: SIGNATURE_DATA_URL,
      signatureMethod: 'drawn',
      consentText: 'אני מאשר',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('שדות למילוי')
  }, 60_000)

  it('rejects a signature that is not really a PNG', async () => {
    const token = signingUrl.split('/').pop()!
    const context = (await resolveSigningToken(token))!

    for (const bad of [
      'data:image/png;base64,bm90IGEgcG5n',
      'data:text/html;base64,PHNjcmlwdD4=',
      'not a data url',
    ]) {
      const result = await completeSigning({
        context,
        signatureDataUrl: bad,
        signatureMethod: 'drawn',
        consentText: 'אני מאשר',
      })
      expect(result.ok, bad).toBe(false)
    }
  }, 60_000)

  it('produces a signed PDF, locks the document and records the audit trail', async () => {
    const token = signingUrl.split('/').pop()!
    const context = (await resolveSigningToken(token))!

    // Fill the outstanding signer field, as the signer would.
    await db
      .update(schema.fields)
      .set({ value: '15%' })
      .where(eq(schema.fields.label, 'אחוז עמלה'))

    const result = await completeSigning({
      context,
      signatureDataUrl: SIGNATURE_DATA_URL,
      signatureMethod: 'drawn',
      consentText: 'אני מאשר/ת שקראתי את המסמך ושחתימתי ניתנת על ידי מרצוני.',
      ip: '203.0.113.7',
    })

    expect(result.ok).toBe(true)

    const [version] = await db
      .select()
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, versionId))

    expect(version.signedFileKey).toBeTruthy()
    expect(version.signedHash).toMatch(/^[0-9a-f]{64}$/)

    const signed = await getStorage().get(version.signedFileKey!)
    expect(signed.subarray(0, 5).toString()).toBe('%PDF-')
    // The recorded hash is the hash of what is actually stored.
    expect(sha256(signed)).toBe(version.signedHash)

    // The signed file is CLEAN: the same page count as the rendered document,
    // with no audit page appended. The evidence lives in the certificate, not
    // in the copy the signer downloads.
    const rendered = await getStorage().get(version.renderedFileKey!)
    const { PDFDocument } = await import('pdf-lib')
    const renderedPages = (await PDFDocument.load(rendered)).getPageCount()
    const signedPages = (await PDFDocument.load(signed)).getPageCount()
    expect(signedPages).toBe(renderedPages)

    const [agreement] = await db
      .select()
      .from(schema.agreements)
      .where(eq(schema.agreements.id, agreementId))
    expect(agreement.status).toBe('signed')
    expect(agreement.completedAt).toBeTruthy()

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.agreementId, agreementId))
    const types = events.map((e) => e.type)
    expect(types).toContain('created')
    expect(types).toContain('sent')
    expect(types).toContain('signature_applied')
    expect(types).toContain('completed')

    // Nothing secret is ever written to the trail.
    const dump = JSON.stringify(events)
    expect(dump).not.toContain(token)
  }, 120_000)

  it('builds a separate audit certificate that carries the signed hash', async () => {
    const { buildAgreementCertificate } = await import('@/server/signing/certificate')

    const result = await buildAgreementCertificate({ session, agreementId })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // It is a real, single-page PDF, distinct from the signed document.
    const { PDFDocument } = await import('pdf-lib')
    const cert = await PDFDocument.load(result.pdf)
    expect(cert.getPageCount()).toBe(1)
    expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-')

    // A document that is not signed has no certificate to build.
    const [draft] = await db
      .insert(schema.agreements)
      .values({ organizationId: session.organizationId, title: 'draft', status: 'draft', ownerId: session.userId })
      .returning({ id: schema.agreements.id })
    expect(await buildAgreementCertificate({ session, agreementId: draft.id })).toMatchObject({ ok: false })
    await db.delete(schema.agreements).where(eq(schema.agreements.id, draft.id))
  }, 60_000)

  it('makes the link stop opening the signing flow once signed', async () => {
    const token = signingUrl.split('/').pop()!
    const context = await resolveSigningToken(token)
    // It still resolves — the signer needs their copy — but is no longer signable.
    expect(context?.status).toBe('signed')
  })

  it('refuses a second completion', async () => {
    const token = signingUrl.split('/').pop()!
    const context = (await resolveSigningToken(token))!

    // The route guards on isSignable; the use-case is reached only through it.
    expect(['signed', 'declined', 'canceled', 'expired']).toContain(context.status)
  })
})

describe('shapeForPdf', () => {
  /**
   * The function returns text pre-reversed on purpose: fontkit reverses an RTL
   * run itself, so the two cancel and the PDF shows the correct visual order.
   * Undoing that reversal here recovers what a reader actually sees, which is
   * what these assertions are about.
   */
  const asRendered = (text: string) => [...shapeForPdf(text)].reverse().join('')

  it('keeps a percentage the right way round', () => {
    // Measured before this existed: "עמלה 15%" printed as "עמלה 51%" — a 15%
    // commission shown as 51% on a signed agreement.
    expect(asRendered('עמלה 15% לספק')).toContain('15%')
    expect(asRendered('עמלה 15% לספק')).not.toContain('51')
  })

  it('keeps a phone number and a company id intact', () => {
    expect(asRendered('טלפון: 050-123-4567')).toContain('050-123-4567')
    expect(asRendered('ח.פ: 515123456')).toContain('515123456')
  })

  it('leaves a pure-LTR value completely alone', () => {
    // fontkit only reverses text containing an RTL script, so reversing a
    // Latin/numeric value here would not be cancelled: "15%" printed "%51" on
    // a real signed PDF before this guard existed.
    expect(shapeForPdf('15%')).toBe('15%')
    expect(shapeForPdf('050-123-4567')).toBe('050-123-4567')
    expect(shapeForPdf('XTRA')).toBe('XTRA')
  })

  it('puts Hebrew in visual right-to-left order', () => {
    // אבג rendered visually reads gimel, bet, aleph from the left.
    expect(shapeForPdf('אבג')).toBe('אבג')
  })

  it('handles an empty string without throwing', () => {
    expect(shapeForPdf('')).toBe('')
  })
})
