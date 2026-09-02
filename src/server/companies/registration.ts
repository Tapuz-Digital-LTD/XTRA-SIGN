import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { createCompany, type CompanyFieldErrors, type CompanyInput, type CompanyKind } from '@/server/companies/companies'
import { createCrmCompany, findCrmMatches, objectTypeFor, type CrmMatch } from '@/server/crm/company-registration'
import { FireberryProvider } from '@/server/crm/fireberry'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'

/**
 * Creating a supplier or customer, optionally in Fireberry too.
 *
 * Every company XTRA Sign uses exists here first — there is no "Fireberry only"
 * company, because a document has to be filed against something local. The CRM
 * is an additional home for the same company, not an alternative one.
 *
 * The four outcomes are kept distinct on purpose, because the failure this
 * guards against is the operator not knowing where their company ended up:
 *
 *   created            — saved here; CRM was not asked for
 *   duplicates         — the CRM already has a candidate; nothing written anywhere
 *   created_and_linked — saved here and in Fireberry, linked
 *   created_crm_failed — saved here, CRM refused; the local row is real and the
 *                        badge stays "XTRA Sign" until a retry succeeds
 */

export type RegisterResult =
  | { ok: true; outcome: 'created' | 'created_and_linked'; id: string }
  | { ok: true; outcome: 'created_crm_failed'; id: string; message: string }
  | { ok: true; outcome: 'duplicates'; matches: CrmMatch[] }
  | { ok: false; message: string; fields?: CompanyFieldErrors }

/** Whether the CRM half of the choice may even be offered. */
export function crmRegistrationAvailable(): boolean {
  return new FireberryProvider().isConfigured()
}

/** A company we already hold for this CRM record, if any. */
async function localCompanyForCrmRecord(
  session: StaffSession,
  crmObjectType: number,
  crmRecordId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.organizationId, session.organizationId),
        eq(schema.companies.crmObjectType, crmObjectType),
        eq(schema.companies.crmRecordId, crmRecordId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .limit(1)
  return row?.id ?? null
}

export async function registerCompany(input: {
  session: StaffSession
  kind: CompanyKind
  data: CompanyInput
  /** 'local' saves here only; 'crm' also creates or links a Fireberry record. */
  target: 'local' | 'crm'
}): Promise<RegisterResult> {
  if (input.target === 'local' || !crmRegistrationAvailable()) {
    return asCreated(await createCompany({ session: input.session, kind: input.kind, data: input.data }))
  }

  // Look before writing anything, anywhere. A search that fails is not an
  // answer of "no duplicates" — it stops the flow instead.
  let matches: CrmMatch[]
  try {
    matches = await findCrmMatches(input.kind, input.data)
  } catch {
    return { ok: false, message: 'לא הצלחנו לבדוק אם החברה כבר קיימת ב-Fireberry. נסו שוב, או שמרו ב-XTRA Sign בלבד.' }
  }
  if (matches.length > 0) return { ok: true, outcome: 'duplicates', matches }

  const local = await createCompany({ session: input.session, kind: input.kind, data: input.data })
  if (!local.ok) return local

  try {
    const { crmRecordId, crmObjectType } = await createCrmCompany(input.kind, input.data)
    await linkLocalToCrm(input.session, local.id, crmRecordId, crmObjectType)
    return { ok: true, outcome: 'created_and_linked', id: local.id }
  } catch (error) {
    log.error('crm company creation failed', { companyId: local.id, error: String(error) })
    // The local company is real and must not be created a second time on retry.
    return {
      ok: true,
      outcome: 'created_crm_failed',
      id: local.id,
      message: 'החברה נשמרה ב-XTRA Sign, אך לא הצלחנו ליצור אותה ב-Fireberry.',
    }
  }
}

/**
 * Attaches a local company to an existing CRM record.
 *
 * Used both by "קשר לרשומה הקיימת" and by a retry after a failed creation. If
 * we already hold a company for that CRM record — synced earlier, most likely —
 * that one is returned instead of making a second local row for the same
 * business.
 */
export async function linkExistingCrmRecord(input: {
  session: StaffSession
  kind: CompanyKind
  data: CompanyInput
  crmRecordId: string
  crmObjectType: number
  /** Link this existing local company rather than creating one. */
  companyId?: string
}): Promise<RegisterResult> {
  const already = await localCompanyForCrmRecord(input.session, input.crmObjectType, input.crmRecordId)
  if (already && already !== input.companyId) return { ok: true, outcome: 'created_and_linked', id: already }

  const companyId =
    input.companyId ??
    (await (async () => {
      const created = await createCompany({ session: input.session, kind: input.kind, data: input.data })
      return created.ok ? created.id : null
    })())

  if (!companyId) return { ok: false, message: 'לא הצלחנו לשמור את החברה.' }

  await linkLocalToCrm(input.session, companyId, input.crmRecordId, input.crmObjectType)
  return { ok: true, outcome: 'created_and_linked', id: companyId }
}

async function linkLocalToCrm(
  session: StaffSession,
  companyId: string,
  crmRecordId: string,
  crmObjectType: number,
): Promise<void> {
  await getDb()
    .update(schema.companies)
    .set({ crmRecordId, crmObjectType, source: 'crm', crmSyncedAt: new Date() })
    .where(
      and(eq(schema.companies.id, companyId), eq(schema.companies.organizationId, session.organizationId)),
    )

  await recordAdminAction({
    organizationId: session.organizationId,
    type: AUDIT_EVENTS.COMPANY_LINKED_TO_CRM,
    actorEmail: session.email,
    metadata: { companyId, crmObjectType },
  })
}

function asCreated(result: { ok: true; id: string } | { ok: false; message: string }): RegisterResult {
  return result.ok ? { ok: true, outcome: 'created', id: result.id } : result
}

export { objectTypeFor }
