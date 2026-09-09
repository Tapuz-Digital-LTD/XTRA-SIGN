import { normalizeIsraeliPhone } from './phone'

/**
 * The registration form's rules, in one place — shared by the page and the
 * server on purpose, like company-validation.ts. Two implementations of "is
 * this a valid company number" drift apart, and the form ends up accepting
 * what the server rejects. The server still validates on its own; this is
 * the same function, not a client-side substitute for it.
 */

/** The four regional weeks, exactly as the agreement lists them. */
export const TOURISM_WEEKS = [
  { id: 'week_1', title: 'שבוע ראשון - ירושלים', dates: '4-7/11', regions: 'ירושלים, מטה יהודה, מעלה אדומים, צפון ים המלח, יהודה ושומרון' },
  { id: 'week_2', title: 'שבוע שני - צפון', dates: '11-14/11', regions: 'צפון, בקעה, שומרון ומחיפה לרמת הגולן' },
  { id: 'week_3', title: 'שבוע שלישי - דרום', dates: '18-21/11', regions: 'מאשדוד לעזה ומזרחה לים המלח, עד אילת' },
  { id: 'week_4', title: 'שבוע רביעי - מרכז', dates: '25-28/11', regions: 'כרמל עד יבנה והשפלה' },
] as const

export type TourismWeekId = (typeof TOURISM_WEEKS)[number]['id']

/** The two ways a customer identifies themselves at the business. */
export const REDEMPTION_METHODS = ['generic_xtra25', 'business_pos_code'] as const
export type RedemptionMethod = (typeof REDEMPTION_METHODS)[number]

export type RegistrationValues = {
  businessName: string
  taxId: string
  /** The name the business trades under, when it differs from the company's. */
  commercialName: string
  signatoryName: string
  signatoryRole: string
  /** E.164. */
  phone: string
  email: string
  /** Up to three lines describing the benefit; the document asks for no minimum. */
  benefit1: string
  benefit2: string
  benefit3: string
  benefitNotes: string
  /** Which regional week the business takes part in. One, and required. */
  week: TourismWeekId
  redemption: RedemptionMethod
  /** Required only when the business uses its own code. */
  couponCode: string
  /** Opt-in, never pre-selected. */
  optionalExtension: boolean
  /** Both declarations are the signer's own, and both are required. */
  declareLicense: boolean
  declareInsurance: boolean
}

export type RegistrationField = keyof RegistrationValues

export const REGISTRATION_LABELS: Record<RegistrationField, string> = {
  businessName: 'שם העסק / החברה',
  taxId: 'מספר ח.פ.',
  commercialName: 'שם העסק המסחרי',
  signatoryName: 'שם מלא של המורשה/ת לחתום',
  signatoryRole: 'תפקיד',
  phone: 'איש קשר + מס׳ טלפון',
  email: 'דוא״ל',
  benefit1: 'סוג ההטבה 1',
  benefit2: 'סוג ההטבה 2',
  benefit3: 'סוג ההטבה 3',
  benefitNotes: 'הערות - טקסט חופשי',
  week: 'שבוע התיירות האזורי',
  redemption: 'קוד קופון / מימוש',
  couponCode: 'מספר קופון',
  optionalExtension: 'הרחבה אופציונלית',
  declareLicense: 'רישיון עסק תקף כחוק',
  declareInsurance: 'פוליסת ביטוח בתוקף',
}

/** A real-looking address: labels without doubled dots, a letters-only top level. */
const EMAIL_RE = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

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

  // The trading name is optional: a business whose commercial name is its
  // company name has nothing to add, and the document does not demand it.
  const commercialName = clean(values.commercialName, 200)

  /*
   * The benefit. The agreement asks the business to describe what it gives,
   * and offers three lines to do it in — it does not ask for three. One is
   * enough; none is not, because the whole document is about the benefit.
   */
  const benefit1 = clean(values.benefit1, 300)
  const benefit2 = clean(values.benefit2, 300)
  const benefit3 = clean(values.benefit3, 300)
  if (!benefit1 && !benefit2 && !benefit3) fields.benefit1 = 'יש לתאר לפחות סוג הטבה אחד.'
  const benefitNotes = clean(values.benefitNotes, 1000)

  const week = TOURISM_WEEKS.find((w) => w.id === values.week)?.id
  if (!week) fields.week = 'יש לבחור את שבוע התיירות האזורי שבו העסק משתתף.'

  const redemption = REDEMPTION_METHODS.find((m) => m === values.redemption)
  if (!redemption) fields.redemption = 'יש לבחור אחת משתי אפשרויות המימוש.'

  // Only the business's own code needs a number; the generic one is XTRA25.
  const couponCode = clean(values.couponCode, 60)
  if (redemption === 'business_pos_code' && !couponCode) fields.couponCode = 'יש להזין את מספר הקופון של קופת בית העסק.'

  const declareLicense = values.declareLicense === true
  if (!declareLicense) fields.declareLicense = 'יש לאשר שברשות בית העסק רישיון עסק תקף כחוק.'
  const declareInsurance = values.declareInsurance === true
  if (!declareInsurance) fields.declareInsurance = 'יש לאשר שברשות בית העסק פוליסת ביטוח בתוקף.'

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return {
    ok: true,
    data: {
      businessName,
      taxId,
      commercialName,
      signatoryName,
      signatoryRole,
      phone: phone!,
      email,
      benefit1,
      benefit2,
      benefit3,
      benefitNotes,
      week: week!,
      redemption: redemption!,
      // A generic code carries no number of its own.
      couponCode: redemption === 'business_pos_code' ? couponCode : '',
      optionalExtension: values.optionalExtension === true,
      declareLicense,
      declareInsurance,
    },
  }
}
