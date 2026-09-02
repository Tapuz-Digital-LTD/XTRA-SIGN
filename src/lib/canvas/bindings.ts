import type { Binding } from './model'

/**
 * Data sources in the words a person uses.
 *
 * The model stores 'company.tax_id'; nobody should ever be shown that. The
 * label is what appears in the editor, and the key is what the renderer fills
 * per recipient.
 */
export const BINDING_LABELS: Record<Binding, string> = {
  'company.name': 'שם החברה',
  'company.tax_id': 'ח.פ / ע.מ',
  'company.address': 'כתובת החברה',
  'company.contact_name': 'שם איש הקשר',
  'company.contact_phone': 'טלפון איש הקשר',
  'company.contact_email': 'אימייל איש הקשר',
  'organization.legal_name': 'שם החברה שלנו',
  'organization.tax_id': 'ח.פ שלנו',
  'organization.address': 'הכתובת שלנו',
  'organization.phone': 'הטלפון שלנו',
  'organization.email': 'האימייל שלנו',
  today: 'תאריך היום',
}
