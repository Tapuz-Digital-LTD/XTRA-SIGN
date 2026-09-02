import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/blob'
import { authorizeAgreementAccess } from './authorization'
import { buildStorageKey } from './file-validation'

/**
 * The document lifecycle actions beyond signing: cancel, duplicate, and start a
 * new version.
 *
 * A signed document is never mutated. "Cancel" stops an open request; "new
 * version" leaves the original untouched and produces a fresh draft that points
 * back at it; "duplicate" is an independent copy. Each copies the PDF to its own
 * storage keys, so two agreements never share a Blob object.
 */

export type LifecycleResult = { ok: true; id: string } | { ok: false; message: string }


/** Stops an open (or draft) request. A signed document cannot be cancelled. */
export async function cancelAgreement(input: {
  session: StaffSession
  agreementId: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status === 'signed') {
    return { ok: false, message: 'לא ניתן לבטל מסמך שכבר נחתם.' }
  }
  if (agreement.status === 'canceled') return { ok: true }

  const db = getDb()
  await db.transaction(async (tx) => {
    // Revoke every live signing token so the link stops opening.
    const recipients = await tx
      .select({ id: schema.recipients.id })
      .from(schema.recipients)
      .where(eq(schema.recipients.agreementId, agreement.id))
    const ids = recipients.map((r) => r.id)
    if (ids.length > 0) {
      await tx
        .update(schema.signingTokens)
        .set({ revokedAt: new Date() })
        .where(and(inArray(schema.signingTokens.recipientId, ids), isNull(schema.signingTokens.revokedAt)))
    }

    await tx
      .update(schema.agreements)
      .set({ status: 'canceled' })
      .where(eq(schema.agreements.id, agreement.id))

    await tx.insert(schema.auditEvents).values({
      agreementId: agreement.id,
      type: AUDIT_EVENTS.CANCELED,
      actor: input.session.email,
    })
  })

  return { ok: true }
}

/** Copies the current version's stored files into fresh keys for a new agreement. */
async function copyVersionFiles(input: {
  organizationId: string
  newAgreementId: string
  sourceFileKey: string | null
  renderedFileKey: string | null
}): Promise<{ sourceKey: string | null; renderedKey: string | null }> {
  const storage = getStorage()

  const copy = async (key: string | null, purpose: 'source' | 'rendered') => {
    if (!key) return null
    const bytes = await storage.get(key)
    const ext = key.split('.').pop() ?? 'pdf'
    const newKey = buildStorageKey({
      organizationId: input.organizationId,
      agreementId: input.newAgreementId,
      purpose,
      ext,
    })
    await storage.put(newKey, bytes, 'application/pdf')
    return newKey
  }

  // If source and rendered are the same object (a PDF), keep them the same after
  // copying, so the new agreement mirrors the old one's shape.
  const sourceKey = await copy(input.sourceFileKey, 'source')
  const renderedKey =
    input.renderedFileKey && input.renderedFileKey === input.sourceFileKey
      ? sourceKey
      : await copy(input.renderedFileKey, 'rendered')

  return { sourceKey, renderedKey }
}

async function cloneAgreement(input: {
  session: StaffSession
  agreementId: string
  title: string
  supersedes?: string
  auditType: string
}): Promise<LifecycleResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  const db = getDb()

  const [version] = await db
    .select()
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, agreement.currentVersionId ?? ''))
    .limit(1)
  if (!version) return { ok: false, message: 'המסמך אינו זמין להעתקה.' }

  const [company] = await db
    .select({ companyId: schema.agreements.companyId })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreement.id))
    .limit(1)

  const newId = crypto.randomUUID()
  const { sourceKey, renderedKey } = await copyVersionFiles({
    organizationId: input.session.organizationId,
    newAgreementId: newId,
    sourceFileKey: version.sourceFileKey,
    renderedFileKey: version.renderedFileKey,
  })

  const pages = await db
    .select()
    .from(schema.documentPages)
    .where(eq(schema.documentPages.agreementVersionId, version.id))

  const sourceFields = await db
    .select()
    .from(schema.fields)
    .where(eq(schema.fields.agreementVersionId, version.id))

  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  await db.transaction(async (tx) => {
    await tx.insert(schema.agreements).values({
      id: newId,
      organizationId: input.session.organizationId,
      companyId: company?.companyId ?? null,
      title: input.title,
      status: 'draft',
      ownerId: input.session.userId,
      supersedesId: input.supersedes ?? null,
    })

    const [newVersion] = await tx
      .insert(schema.agreementVersions)
      .values({
        agreementId: newId,
        versionNumber: 1,
        sourceFileKey: sourceKey,
        renderedFileKey: renderedKey,
        renderedHash: version.renderedHash,
        pageCount: version.pageCount,
      })
      .returning({ id: schema.agreementVersions.id })

    await tx.update(schema.agreements).set({ currentVersionId: newVersion.id }).where(eq(schema.agreements.id, newId))

    if (pages.length > 0) {
      await tx.insert(schema.documentPages).values(
        pages.map((p) => ({
          agreementVersionId: newVersion.id,
          pageNumber: p.pageNumber,
          widthPt: p.widthPt,
          heightPt: p.heightPt,
        })),
      )
    }

    if (sourceFields.length > 0) {
      await tx.insert(schema.fields).values(
        sourceFields.map((f) => ({
          agreementVersionId: newVersion.id,
          type: f.type,
          label: f.label,
          variableKey: f.variableKey,
          ownedBy: f.ownedBy,
          required: f.required,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          options: f.options,
          placeholder: f.placeholder,
          autoFill: f.autoFill,
          // A copy starts unfilled for whatever the signer provides; our own
          // fixed values are carried over.
          value: f.ownedBy === 'sender' ? f.value : null,
        })),
      )
    }

    if (recipient) {
      await tx.insert(schema.recipients).values({
        agreementId: newId,
        name: recipient.name,
        company: recipient.company,
        phone: recipient.phone,
        email: recipient.email,
      })
    }

    await tx.insert(schema.auditEvents).values({
      agreementId: newId,
      type: input.auditType,
      actor: input.session.email,
      metadata: input.supersedes ? { supersedes: input.supersedes } : undefined,
    })
  })

  return { ok: true, id: newId }
}

/** An independent copy, ready to edit and send to anyone. */
export async function duplicateAgreement(input: {
  session: StaffSession
  agreementId: string
}): Promise<LifecycleResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  return cloneAgreement({
    session: input.session,
    agreementId: input.agreementId,
    title: `${agreement.title} (עותק)`,
    auditType: 'created',
  })
}

/** A fresh draft that supersedes the original, which is left untouched. */
export async function createNewVersion(input: {
  session: StaffSession
  agreementId: string
}): Promise<LifecycleResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  return cloneAgreement({
    session: input.session,
    agreementId: input.agreementId,
    title: agreement.title,
    supersedes: agreement.id,
    auditType: AUDIT_EVENTS.NEW_VERSION_CREATED,
  })
}

/** The version chain around a document, for a small history on its page. */
export async function versionChain(session: StaffSession, agreementId: string) {
  const db = getDb()
  const scope = session.isAdmin
    ? eq(schema.agreements.organizationId, session.organizationId)
    : and(
        eq(schema.agreements.organizationId, session.organizationId),
        eq(schema.agreements.ownerId, session.userId),
      )

  const [self] = await db
    .select({ id: schema.agreements.id, supersedesId: schema.agreements.supersedesId })
    .from(schema.agreements)
    .where(and(eq(schema.agreements.id, agreementId), scope))
    .limit(1)
  if (!self) return { predecessor: null, successors: [] as { id: string; title: string; status: string; createdAt: Date }[] }

  const [predecessor] = self.supersedesId
    ? await db
        .select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, createdAt: schema.agreements.createdAt })
        .from(schema.agreements)
        .where(and(eq(schema.agreements.id, self.supersedesId), scope))
        .limit(1)
    : []

  const successors = await db
    .select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, createdAt: schema.agreements.createdAt })
    .from(schema.agreements)
    .where(and(eq(schema.agreements.supersedesId, agreementId), scope, ne(schema.agreements.id, agreementId)))
    .orderBy(desc(schema.agreements.createdAt))

  return { predecessor: predecessor ?? null, successors }
}
