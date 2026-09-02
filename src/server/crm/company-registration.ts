import { normalizeIsraeliPhone } from '@/lib/phone'
import type { CompanyKind } from '@/server/companies/companies'
import { log } from '@/server/log'
import { FireberryProvider } from './fireberry'

/**
 * Creating a company in Fireberry, or finding the one that is already there.
 *
 * The rule this exists to enforce: never make a second record for a company the
 * CRM already knows. Duplicate customers are expensive to undo and quietly
 * corrupt every report built on top of them, so a match is surfaced to the
 * operator to confirm rather than resolved by guessing here.
 *
 * Matching is ordered by how much a field actually identifies a business. A tax
 * id is an identity; an email or a phone is strong but shared more often than
 * people expect; a name is a hint and never enough on its own — "מ.כ. שיווק"
 * matching "מ.כ. שיווק בע\"מ" may or may not be the same company, and that is
 * exactly the call a person should make.
 */

const CUSTOMER_OBJECT = 1
const SUPPLIER_OBJECT = 1000

export type MatchStrength = 'taxId' | 'email' | 'phone' | 'name'

export type CrmMatch = {
  crmRecordId: string
  crmObjectType: number
  name: string
  taxId: string | null
  contactPhone: string | null
  contactEmail: string | null
  /** Which field matched. 'name' alone is a hint, never a confirmation. */
  matchedOn: MatchStrength
}

export type CompanyDetails = {
  name: string
  taxId?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
}

export function objectTypeFor(kind: CompanyKind): number {
  return kind === 'customer' ? CUSTOMER_OBJECT : SUPPLIER_OBJECT
}

/** Fireberry's own field names, per object. */
function fieldMap(kind: CompanyKind) {
  return kind === 'customer'
    ? { id: 'accountid', name: 'accountname', taxId: 'idnumber', phone: 'telephone1', email: 'emailaddress1' }
    : { id: 'customobject1000id', name: 'name', taxId: 'pcfvatid', phone: 'pcfsystemfield104', email: 'pcfsystemfield125' }
}

/** A value safe to drop into a Fireberry query literal. */
function queryable(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /['")(]/.test(trimmed)) return null
  return trimmed
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

/**
 * Looks for an existing CRM record, strongest signal first.
 *
 * Returns as soon as a strong field matches: once a tax id agrees there is
 * nothing a weaker field could add. A name-only result is returned too, marked
 * as such, so the UI can present it as "possibly this" rather than "this".
 */
export async function findCrmMatches(kind: CompanyKind, details: CompanyDetails): Promise<CrmMatch[]> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return []

  const objectType = objectTypeFor(kind)
  const f = fieldMap(kind)
  const phone = details.contactPhone ? normalizeIsraeliPhone(details.contactPhone) : null

  const attempts: { field: string; value: string | null; strength: MatchStrength }[] = [
    { field: f.taxId, value: details.taxId ? queryable(details.taxId) : null, strength: 'taxId' },
    { field: f.email, value: details.contactEmail ? queryable(details.contactEmail) : null, strength: 'email' },
    { field: f.phone, value: phone ? queryable(phone) : null, strength: 'phone' },
    { field: f.name, value: queryable(details.name), strength: 'name' },
  ]

  for (const attempt of attempts) {
    if (!attempt.value) continue
    try {
      const batch = await provider.queryRecords({
        objectType,
        fields: [f.id, f.name, f.taxId, f.phone, f.email],
        pageNumber: 1,
        pageSize: 5,
        query: `(${attempt.field} = ${attempt.value})`,
      })
      const matches = batch.rows
        .map((row) => {
          const crmRecordId = str(row[f.id])
          if (!crmRecordId) return null
          return {
            crmRecordId,
            crmObjectType: objectType,
            name: str(row[f.name]) ?? '(ללא שם)',
            taxId: str(row[f.taxId]),
            contactPhone: str(row[f.phone]),
            contactEmail: str(row[f.email]),
            matchedOn: attempt.strength,
          }
        })
        .filter((m): m is CrmMatch => m !== null)

      if (matches.length > 0) return matches
    } catch (error) {
      // A search that cannot run must not be read as "no duplicates exist" —
      // that is precisely how a duplicate gets created.
      log.error('crm duplicate search failed', { field: attempt.field, error: String(error) })
      throw new Error('duplicate_search_failed')
    }
  }

  return []
}

/** Creates the record in Fireberry and returns its id. */
export async function createCrmCompany(
  kind: CompanyKind,
  details: CompanyDetails,
): Promise<{ crmRecordId: string; crmObjectType: number }> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) throw new Error('CRM is not configured')

  const objectType = objectTypeFor(kind)
  const f = fieldMap(kind)
  const phone = details.contactPhone ? normalizeIsraeliPhone(details.contactPhone) ?? details.contactPhone : null

  const fields: Record<string, string | null> = {
    [f.name]: details.name,
    [f.taxId]: details.taxId ?? null,
    [f.phone]: phone,
    [f.email]: details.contactEmail ?? null,
  }
  // A supplier keeps the contact's given name in its own field. A customer's
  // contact lives on a separate Contact record in Fireberry, which this does
  // not create — the account carries the phone and email, and the contact
  // person is filled in the CRM if someone wants it there.
  if (kind === 'supplier' && details.contactName) fields.pcfsystemfield100 = details.contactName

  const crmRecordId = await provider.createRecord(objectType, fields)
  if (!crmRecordId) throw new Error('Fireberry did not return a record id')

  return { crmRecordId, crmObjectType: objectType }
}
