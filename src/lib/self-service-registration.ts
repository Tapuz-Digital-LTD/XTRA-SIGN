import { normalizeIsraeliPhone } from './phone'

/**
 * The registration form's rules, in one place — shared by the page and the
 * server on purpose, like company-validation.ts. Two implementations of "is
 * this a valid company number" drift apart, and the form ends up accepting
 * what the server rejects. The server still validates on its own; this is
 * the same function, not a client-side substitute for it.
 */

export type RegistrationValues = {
  businessName: string
  taxId: string
  signatoryName: string
  signatoryRole: string
  /** E.164. */
  phone: string
  email: string
}

export type RegistrationField = keyof RegistrationValues

export const REGISTRATION_LABELS: Record<RegistrationField, string> = {
  businessName: 'שם העסק / החברה',
  taxId: 'מספר ח.פ. / ע.מ.',
  signatoryName: 'שם מלא של מורשה/ת החתימה',
  signatoryRole: 'תפקיד',
  phone: 'טלפון נייד',
  email: 'דוא״ל',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''

export type RegistrationValidation =
  | { ok: true; data: RegistrationValues }
  | { ok: false; fields: Partial<Record<RegistrationField, string>> }

/** Hostile input in, six clean values out — or a message per field. */
export function validateRegistration(values: Record<string, unknown>): RegistrationValidation {
  const fields: Partial<Record<RegistrationField, string>> = {}

  const businessName = clean(values.businessName, 200)
  if (businessName.length < 2) fields.businessName = 'יש להזין את שם העסק.'

  const taxId = clean(values.taxId, 40).replace(/\D/g, '')
  if (!/^\d{8,9}$/.test(taxId)) fields.taxId = 'יש להזין ח.פ. / ע.מ. תקין (8–9 ספרות).'

  const signatoryName = clean(values.signatoryName, 120)
  if (signatoryName.length < 2) fields.signatoryName = 'יש להזין את שם מורשה החתימה.'

  const signatoryRole = clean(values.signatoryRole, 80)
  if (!signatoryRole) fields.signatoryRole = 'יש להזין תפקיד.'

  const phone = normalizeIsraeliPhone(clean(values.phone, 40))
  if (!phone) fields.phone = 'יש להזין מספר נייד ישראלי תקין. לדוגמה 050-1234567.'

  const email = clean(values.email, 200).toLowerCase()
  if (!EMAIL_RE.test(email)) fields.email = 'יש להזין כתובת אימייל תקינה.'

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, data: { businessName, taxId, signatoryName, signatoryRole, phone: phone!, email } }
}
