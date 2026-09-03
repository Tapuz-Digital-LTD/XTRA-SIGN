/**
 * The public identity of the tourism campaign form.
 *
 * The slug is the publishable, scoped identifier of the "שבוע התיירות 2026"
 * project's joining form — its only public power is creating a lead. The page
 * and the ops script (scripts/tourism-project.ts) share these constants so the
 * two can never drift apart.
 */
export const TOURISM_FORM_SLUG = 'aDwRvKYwKF0'

/** Stamped into each lead's meta so future leads can be traced to a form era. */
export const TOURISM_FORM_VERSION = '2026-09-03.1'

/** The published field ids this page maps onto (system ids + one custom). */
export const FIELD_IDS = {
  businessName: 'name',
  taxId: 'taxId',
  benefitType: 'custom_benefit_type',
  contactName: 'contactName',
  phone: 'phone',
  email: 'email',
} as const
