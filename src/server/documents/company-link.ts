import { and, eq, isNull } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess, isUuid } from './authorization'

/**
 * Filing a document under a supplier or customer.
 *
 * Separate from creating one because a document can arrive without a company —
 * from a template, or from an upload made outside a company's page — and
 * without a way to attach it afterwards it is only ever findable in the flat
 * document list. That is metadata about where a document belongs, not part of
 * what was signed: attaching it changes no PDF and no hash, so it stays
 * available after signing, which is the only way an already-signed document can
 * be filed at all.
 *
 * The company id comes from the client, so it is resolved inside the caller's
 * own organization and nowhere else; an id from another tenant reads as "not
 * found", the same answer the document routes give.
 */

export type LinkResult = { ok: true; companyName: string | null } | { ok: false; message: string }

export async function setDocumentCompany(input: {
  session: StaffSession
  agreementId: string
  /** null detaches the document from any company. */
  companyId: string | null
}): Promise<LinkResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  const db = getDb()

  let companyName: string | null = null
  if (input.companyId !== null) {
    if (!isUuid(input.companyId)) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }

    const [company] = await db
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.id, input.companyId),
          eq(schema.companies.organizationId, input.session.organizationId),
          isNull(schema.companies.deletedAt),
        ),
      )
      .limit(1)

    if (!company) return { ok: false, message: 'הספק או הלקוח לא נמצא.' }
    companyName = company.name
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.agreements)
      .set({ companyId: input.companyId })
      .where(eq(schema.agreements.id, agreement.id))

    await tx.insert(schema.auditEvents).values({
      agreementId: agreement.id,
      type: AUDIT_EVENTS.COMPANY_LINKED,
      actor: input.session.email,
      metadata: { companyId: input.companyId, companyName },
    })
  })

  return { ok: true, companyName }
}
