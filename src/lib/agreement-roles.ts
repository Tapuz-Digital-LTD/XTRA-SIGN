import type { FieldType } from './fields'

/**
 * What a self-service agreement needs to know where to put things.
 *
 * A role is a human question — "where does the business name go?" — with a
 * stable key the filling code uses. A template's fields carry the key as
 * their `variableKey`; the settings screen shows only the Hebrew. Nothing in
 * the UI says AcroForm, id or geometry.
 */

export type AgreementRole =
  | 'business_name'
  | 'company_number'
  | 'contact_phone'
  | 'contact_email'
  | 'authorized_signatory'
  | 'signatory_role'
  | 'typed_signature'
  | 'signature_date'

export const AGREEMENT_ROLES: {
  key: AgreementRole
  label: string
  /** Without these the flow cannot produce a signed agreement worth the name. */
  required: boolean
  /** The field type the role needs; anything else is refused in the mapping. */
  type: FieldType
  /** Names a form designer tends to use for this box — lower-cased, matched by substring. */
  hints: string[]
}[] = [
  { key: 'business_name', label: 'שם העסק / החברה', required: true, type: 'text', hints: ['business', 'company_name', 'companyname', 'שם העסק', 'name'] },
  { key: 'company_number', label: 'מספר ח.פ. / ע.מ.', required: true, type: 'text', hints: ['company_number', 'tax', 'vat', 'ח.פ', 'hp', 'id_number', 'number'] },
  { key: 'contact_phone', label: 'טלפון', required: false, type: 'phone', hints: ['phone', 'tel', 'mobile', 'טלפון'] },
  { key: 'contact_email', label: 'אימייל', required: false, type: 'email', hints: ['email', 'mail', 'דוא'] },
  { key: 'authorized_signatory', label: 'שם מורשה החתימה', required: false, type: 'text', hints: ['signatory', 'signer_name', 'authorized', 'מורשה'] },
  { key: 'signatory_role', label: 'תפקיד', required: false, type: 'text', hints: ['role', 'title', 'position', 'תפקיד'] },
  { key: 'typed_signature', label: 'חתימה', required: true, type: 'signature', hints: ['signature', 'sign', 'חתימה'] },
  { key: 'signature_date', label: 'תאריך החתימה', required: false, type: 'date', hints: ['date', 'תאריך'] },
]

export const ROLE_LABELS: Record<AgreementRole, string> = Object.fromEntries(
  AGREEMENT_ROLES.map((r) => [r.key, r.label]),
) as Record<AgreementRole, string>

export function isAgreementRole(value: unknown): value is AgreementRole {
  return typeof value === 'string' && AGREEMENT_ROLES.some((r) => r.key === value)
}

/**
 * A first guess at which role a box serves, from its name and type — offered
 * to the person, never saved without them. Specific hints win over generic
 * ones ("company_number" before "name"), and a role already taken by another
 * box is not proposed twice.
 */
export function suggestRole(
  field: { label: string; variableKey?: string | null; type: FieldType },
  taken: Set<AgreementRole>,
): AgreementRole | null {
  const name = `${field.variableKey ?? ''} ${field.label}`.toLowerCase()
  // Exact key first: a template that already carries our keys maps itself.
  const exact = AGREEMENT_ROLES.find((r) => r.key === field.variableKey)
  if (exact && !taken.has(exact.key) && exact.type === field.type) return exact.key

  const candidates = AGREEMENT_ROLES.filter((r) => !taken.has(r.key) && r.type === field.type)
  // Longer hints are more specific; try them first across all candidates.
  const scored = candidates
    .flatMap((r) => r.hints.filter((h) => name.includes(h)).map((h) => ({ role: r.key, len: h.length })))
    .sort((a, b) => b.len - a.len)
  return scored[0]?.role ?? null
}

/** The roles a mapping is missing, required ones first. */
export function missingRoles(mapped: Iterable<AgreementRole | null | undefined>): { key: AgreementRole; label: string; required: boolean }[] {
  const have = new Set([...mapped].filter(Boolean))
  return AGREEMENT_ROLES.filter((r) => !have.has(r.key)).map((r) => ({ key: r.key, label: r.label, required: r.required }))
}
