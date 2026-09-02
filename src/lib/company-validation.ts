import { normalizeIsraeliPhone } from './phone'

/**
 * The rules for a company's fields, in one place.
 *
 * Shared by the form and the server on purpose. Two implementations of "is this
 * a valid Israeli mobile" drift apart, and the form ends up accepting what the
 * server rejects — or worse, rejecting what the server would have accepted.
 * The server still validates on its own; this is the same function, not a
 * client-side substitute for it.
 */

export type CompanyField = 'name' | 'taxId' | 'contactPhone' | 'contactEmail'
export type CompanyFieldErrors = Partial<Record<CompanyField, string>>

export function validateCompanyField(field: CompanyField, raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()

  if (field === 'name') {
    return value ? null : 'יש להזין שם.'
  }
  if (!value) return null // everything else is optional

  if (field === 'contactEmail') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'כתובת האימייל אינה תקינה.'
  }
  if (field === 'contactPhone') {
    return normalizeIsraeliPhone(value) ? null : 'מספר הטלפון אינו תקין. לדוגמה 050-1234567.'
  }
  if (field === 'taxId') {
    return /\d/.test(value) ? null : 'ח.פ / ע.מ אמור להכיל ספרות.'
  }
  return null
}

/** Every field at once, for a submit. */
export function validateCompanyFields(values: Partial<Record<CompanyField, string | null>>): CompanyFieldErrors {
  const errors: CompanyFieldErrors = {}
  for (const field of ['name', 'taxId', 'contactPhone', 'contactEmail'] as CompanyField[]) {
    const message = validateCompanyField(field, values[field])
    if (message) errors[field] = message
  }
  return errors
}
