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
  { id: 'week_2', title: 'שבוע שני - צפון', dates: '11-14/11', regions: 'צפון, גליל, רמת הגולן וחיפה' },
  { id: 'week_3', title: 'שבוע שלישי - דרום', dates: '18-21/11', regions: 'אשדוד, אשקלון, ים המלח, אילת וערבה' },
  { id: 'week_4', title: 'שבוע רביעי - מרכז', dates: '25-28/11', regions: 'מרכז, כרמל עד יבנה והשפלה' },
] as const

export type TourismWeekId = (typeof TOURISM_WEEKS)[number]['id']

/** The agreement's words around the week and the declarations — the same in both tracks, the form and the 18 ₪ document. */
export const WEEK_CLAUSE = 'ההטבה הנ״ל מחייבת במהלך שבוע התיירות האזורי שבו משתתף בית העסק, בפרט מיום רביעי ועד מוצ״ש באותו השבוע.'
export const WEEK_LEGEND = 'תאריכי ההטבה ע״פ אזורי חלוקה - נובמבר 2026'
export const EXTENSION_CLAUSE = 'הרחבה אופציונלית: במידה ובית העסק יבחר בכך (על פי שיקול דעתו הבלעדי), יורשה להעניק את ההטבה, לאורך כל שבוע התיירות האזורי.'
export const DECLARE_LICENSE_TEXT = 'הנני מצהיר/ה כי ברשות בית העסק רישיון עסק תקף כחוק.'
export const DECLARE_INSURANCE_TEXT = 'הנני מצהיר/ה כי ברשות בית העסק פוליסת ביטוח בתוקף.'

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
  /** The person to speak to at the business — the document asks for them beside the phone. */
  contactPerson: string
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
  /** Empty only in the 18 ₪ version, which has no coupon: the customer comes with an XTRA voucher. */
  redemption: RedemptionMethod | ''
  /** Required only when the business uses its own code. */
  couponCode: string
  /** Opt-in, never pre-selected. */
  optionalExtension: boolean
  /** Both declarations are the signer's own, and both are required. */
  declareLicense: boolean
  declareInsurance: boolean

  /**
   * The "הטבת 18 ₪" version: the benefit is up to three rows — what it is,
   * its tourism-month price and the price on the business's site — instead of
   * benefit lines and a coupon, and the agreement carries the Tapuznet
   * appendix (benefit18.ts), which asks for the address and the bank
   * account. In every other version these are empty and nothing asks for them.
   */
  withAppendix: boolean
  address: string
  city: string
  /** Prices are shekels, digits only. */
  service1Type: string
  service1TourismPrice: string
  service1SitePrice: string
  service2Type: string
  service2TourismPrice: string
  service2SitePrice: string
  service3Type: string
  service3TourismPrice: string
  service3SitePrice: string
  bankAccountName: string
  bankName: string
  bankNumber: string
  bankBranch: string
  bankBranchName: string
  bankAccount: string
}

export type RegistrationField = keyof RegistrationValues

export const REGISTRATION_LABELS: Record<RegistrationField, string> = {
  businessName: 'שם העסק / החברה',
  taxId: 'מספר ח.פ.',
  commercialName: 'שם העסק המסחרי',
  signatoryName: 'שם מלא של המורשה/ת לחתום',
  signatoryRole: 'תפקיד',
  contactPerson: 'איש קשר',
  phone: 'מס׳ טלפון',
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
  withAppendix: 'הטבת 18 ₪',
  address: 'כתובת (רחוב ומספר)',
  city: 'עיר / יישוב',
  service1Type: 'סוג ההטבה',
  service1TourismPrice: 'מחיר לטובת חודש התיירות',
  service1SitePrice: 'מחיר קבוע באתר',
  service2Type: 'סוג ההטבה',
  service2TourismPrice: 'מחיר לטובת חודש התיירות',
  service2SitePrice: 'מחיר קבוע באתר',
  service3Type: 'סוג ההטבה',
  service3TourismPrice: 'מחיר לטובת חודש התיירות',
  service3SitePrice: 'מחיר קבוע באתר',
  bankAccountName: 'שם החשבון',
  bankName: 'שם הבנק',
  bankNumber: 'מספר בנק',
  bankBranch: 'מספר סניף',
  bankBranchName: 'שם הסניף',
  bankAccount: 'מספר החשבון',
}

/** The 18 ₪ benefit, row by row: what it is, its tourism-month price, its price on the business's site. */
export const SERVICE_ROW_FIELDS = [
  ['service1Type', 'service1TourismPrice', 'service1SitePrice'],
  ['service2Type', 'service2TourismPrice', 'service2SitePrice'],
  ['service3Type', 'service3TourismPrice', 'service3SitePrice'],
] as const satisfies readonly (readonly RegistrationField[])[]

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

  const contactPerson = clean(values.contactPerson, 120)
  if (contactPerson.length < 2) fields.contactPerson = 'יש להזין את שם איש הקשר.'

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
  // The 18 ₪ version describes its benefit in rows of its own (validateAppendix), not in these lines.
  const benefit18 = values.withAppendix === true
  const benefit1 = benefit18 ? '' : clean(values.benefit1, 300)
  const benefit2 = benefit18 ? '' : clean(values.benefit2, 300)
  const benefit3 = benefit18 ? '' : clean(values.benefit3, 300)
  if (!benefit18 && !benefit1 && !benefit2 && !benefit3) fields.benefit1 = 'יש לתאר לפחות סוג הטבה אחד.'
  const benefitNotes = clean(values.benefitNotes, 1000)

  const week = TOURISM_WEEKS.find((w) => w.id === values.week)?.id
  if (!week) fields.week = 'יש לבחור את שבוע התיירות האזורי שבו העסק משתתף.'

  // No coupon in the 18 ₪ version: the customer comes with an XTRA voucher number.
  const redemption = benefit18 ? '' : REDEMPTION_METHODS.find((m) => m === values.redemption)
  if (redemption === undefined) fields.redemption = 'יש לבחור אחת משתי אפשרויות המימוש.'

  // Only the business's own code needs a number; the generic one is XTRA25.
  const couponCode = clean(values.couponCode, 60)
  if (redemption === 'business_pos_code' && !couponCode) fields.couponCode = 'יש להזין את מספר הקופון של קופת בית העסק.'

  const declareLicense = values.declareLicense === true
  if (!declareLicense) fields.declareLicense = 'יש לאשר שברשות בית העסק רישיון עסק תקף כחוק.'
  const declareInsurance = values.declareInsurance === true
  if (!declareInsurance) fields.declareInsurance = 'יש לאשר שברשות בית העסק פוליסת ביטוח בתוקף.'

  const appendix = validateAppendix(values, fields)
  // The 18 ₪ rows are its benefit lines too: the agreement's boxes, the tables and the exports read them there.
  const lines = benefit18 ? [0, 1, 2].map((i) => benefitLine(appendix, i)) : [benefit1, benefit2, benefit3]

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return {
    ok: true,
    data: {
      ...appendix,
      businessName,
      taxId,
      commercialName,
      signatoryName,
      signatoryRole,
      contactPerson,
      phone: phone!,
      email,
      benefit1: lines[0],
      benefit2: lines[1],
      benefit3: lines[2],
      benefitNotes,
      week: week!,
      redemption: redemption ?? '',
      // A generic code carries no number of its own.
      couponCode: redemption === 'business_pos_code' ? couponCode : '',
      optionalExtension: values.optionalExtension === true,
      declareLicense,
      declareInsurance,
    },
  }
}

export type AppendixValues = Pick<RegistrationValues, Extract<RegistrationField, 'withAppendix' | 'address' | 'city' | 'bankAccountName' | 'bankName' | 'bankNumber' | 'bankBranch' | 'bankBranchName' | 'bankAccount' | `service${1 | 2 | 3}${'Type' | 'TourismPrice' | 'SitePrice'}`>>

/** "כניסה לאתר: 60 ₪ (במקום 90 ₪)" — one 18 ₪ benefit row, written as a benefit line. */
export function benefitLine(values: Pick<RegistrationValues, (typeof SERVICE_ROW_FIELDS)[number][number]>, index: number): string {
  const [type, tourism, site] = SERVICE_ROW_FIELDS[index]
  return values[type] ? `${values[type]}: ${values[tourism]} ₪ (במקום ${values[site]} ₪)` : ''
}

/** "₪ 1,200" → "1200". Shekels, up to two decimals; anything else is not a price. */
function shekels(value: unknown): string | null {
  const raw = clean(value, 40).replace(/[₪,\s]/g, '')
  return /^\d{1,6}(\.\d{1,2})?$/.test(raw) ? raw : null
}

/** The 18 ₪ answers in every version that does not ask for them. */
export const NO_APPENDIX: AppendixValues = {
  withAppendix: false,
  address: '',
  city: '',
  service1Type: '',
  service1TourismPrice: '',
  service1SitePrice: '',
  service2Type: '',
  service2TourismPrice: '',
  service2SitePrice: '',
  service3Type: '',
  service3TourismPrice: '',
  service3SitePrice: '',
  bankAccountName: '',
  bankName: '',
  bankNumber: '',
  bankBranch: '',
  bankBranchName: '',
  bankAccount: '',
}

/**
 * The 18 ₪ answers, when the version asks for them. A benefit row is checked
 * only once something was typed in it, and the filled ones are moved up, so
 * the document's table never has a hole in it. The tourism-month price is the
 * special one: it has to be below the price on the site.
 */
function validateAppendix(values: Record<string, unknown>, fields: Partial<Record<RegistrationField, string>>): AppendixValues {
  if (values.withAppendix !== true) return NO_APPENDIX

  const out: AppendixValues = { ...NO_APPENDIX, withAppendix: true }

  out.address = clean(values.address, 120)
  if (out.address.length < 2) fields.address = 'יש להזין את כתובת בית העסק.'
  out.city = clean(values.city, 60)
  if (out.city.length < 2) fields.city = 'יש להזין עיר או יישוב.'

  const rows: { type: string; tourism: string; site: string }[] = []
  SERVICE_ROW_FIELDS.forEach(([typeKey, tourismKey, siteKey]) => {
    const type = clean(values[typeKey], 60)
    const typedTourism = clean(values[tourismKey], 40)
    const typedSite = clean(values[siteKey], 40)
    if (!type && !typedTourism && !typedSite) return
    const tourism = shekels(typedTourism)
    const site = shekels(typedSite)
    if (!type) fields[typeKey] = 'יש להזין את סוג ההטבה, לדוגמה ביקור, סדנה או כניסה לאתר.'
    if (tourism === null) fields[tourismKey] = 'יש להזין את המחיר לחודש התיירות בשקלים, לדוגמה 60.'
    else if (site !== null && Number(tourism) >= Number(site)) fields[tourismKey] = 'המחיר לחודש התיירות צריך להיות נמוך מהמחיר הקבוע באתר.'
    if (site === null) fields[siteKey] = 'יש להזין את המחיר הקבוע באתר בשקלים, לדוגמה 90.'
    rows.push({ type, tourism: tourism ?? '', site: site ?? '' })
  })
  if (rows.length === 0) fields.service1Type = 'יש לפרט לפחות הטבה אחת.'
  rows.forEach((row, i) => {
    const [typeKey, tourismKey, siteKey] = SERVICE_ROW_FIELDS[i]
    out[typeKey] = row.type
    out[tourismKey] = row.tourism
    out[siteKey] = row.site
  })

  out.bankAccountName = clean(values.bankAccountName, 120)
  if (out.bankAccountName.length < 2) fields.bankAccountName = 'יש להזין את השם שבו רשום החשבון.'
  out.bankName = clean(values.bankName, 80)
  if (out.bankName.length < 2) fields.bankName = 'יש לבחור את הבנק.'
  out.bankNumber = clean(values.bankNumber, 10).replace(/\D/g, '')
  if (!/^\d{1,3}$/.test(out.bankNumber)) fields.bankNumber = 'יש להזין את מספר הבנק (עד 3 ספרות).'
  out.bankBranch = clean(values.bankBranch, 10).replace(/\D/g, '')
  if (!/^\d{1,4}$/.test(out.bankBranch)) fields.bankBranch = 'יש להזין את מספר הסניף.'
  out.bankBranchName = clean(values.bankBranchName, 80)
  out.bankAccount = clean(values.bankAccount, 40).replace(/[\s-]/g, '')
  if (!/^\d{2,13}$/.test(out.bankAccount)) fields.bankAccount = 'יש להזין את מספר החשבון, ספרות בלבד.'

  return out
}
