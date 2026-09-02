import type { CompanyKind } from '@/server/companies/companies'

/**
 * Filling a template's sender fields from the company it is being sent to.
 *
 * Without this a group send produces one PDF repeated forty times, with the
 * first company's name on every copy. Each source names one fact about the
 * company, resolved per recipient at send time, so the document that reaches a
 * signer is about them.
 */

export type AutoSource =
  | 'company.name'
  | 'company.tax_id'
  | 'company.contact_name'
  | 'company.contact_phone'
  | 'company.contact_email'
  | 'company.address'
  | 'today'

/** Offered in the field editor. Order is the order they appear in the menu. */
export const AUTO_SOURCES: { value: AutoSource; label: string }[] = [
  { value: 'company.name', label: 'שם החברה' },
  { value: 'company.tax_id', label: 'ח.פ / ע.מ' },
  { value: 'company.contact_name', label: 'שם איש הקשר' },
  { value: 'company.contact_phone', label: 'טלפון איש הקשר' },
  { value: 'company.contact_email', label: 'אימייל איש הקשר' },
  { value: 'company.address', label: 'כתובת' },
  { value: 'today', label: 'תאריך השליחה' },
]

const LABELS = new Map(AUTO_SOURCES.map((source) => [source.value, source.label]))

export function isAutoSource(value: unknown): value is AutoSource {
  return typeof value === 'string' && LABELS.has(value as AutoSource)
}

/** What to call a source when explaining that it could not be filled. */
export function autoSourceLabel(source: string): string {
  return LABELS.get(source as AutoSource) ?? source
}

export type PersonalizationSubject = {
  name: string
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  kind?: CompanyKind
}

/**
 * The value a source resolves to for one company, or null when the company has
 * nothing to put there.
 *
 * Returning null rather than an empty string is deliberate: a blank line on a
 * signed agreement is worse than refusing to send it, so the caller can stop
 * and say which company is missing what.
 */
export function resolveAutoSource(
  source: string,
  subject: PersonalizationSubject,
  now: Date = new Date(),
): string | null {
  switch (source) {
    case 'company.name':
      return subject.name.trim() || null
    case 'company.tax_id':
      return subject.taxId?.trim() || null
    case 'company.contact_name':
      return subject.contactName?.trim() || null
    case 'company.contact_phone':
      return subject.contactPhone?.trim() || null
    case 'company.contact_email':
      return subject.contactEmail?.trim() || null
    case 'company.address':
      return subject.address?.trim() || null
    case 'today':
      // The sender's calendar day, which is what "תאריך" means on an agreement.
      return new Intl.DateTimeFormat('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Jerusalem',
      }).format(now)
    default:
      return null
  }
}

export type PersonalizationGap = { label: string; source: string }

/**
 * Resolves every auto field for one company.
 *
 * Reports the gaps instead of throwing: the caller shows the whole batch at
 * once, and "two of these forty are missing a ח.פ" is a far more useful screen
 * than failing on the first one.
 */
export function personalize(
  fields: { id: string; label: string; autoSource: string | null; required: boolean }[],
  subject: PersonalizationSubject,
  now?: Date,
): { values: Map<string, string>; missing: PersonalizationGap[] } {
  const values = new Map<string, string>()
  const missing: PersonalizationGap[] = []

  for (const field of fields) {
    if (!field.autoSource) continue
    const resolved = resolveAutoSource(field.autoSource, subject, now)
    if (resolved === null) {
      if (field.required) missing.push({ label: field.label, source: field.autoSource })
      continue
    }
    values.set(field.id, resolved)
  }

  return { values, missing }
}
