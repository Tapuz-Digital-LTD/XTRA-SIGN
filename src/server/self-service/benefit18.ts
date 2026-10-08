import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlacedField } from '@/lib/fields'
import { toIsraeliNationalFormat } from '@/lib/phone'
import { SERVICE_ROW_FIELDS, type RegistrationValues } from '@/lib/self-service-registration'
import { BENEFIT18_PAGES, BENEFIT18_SLOTS, type Benefit18Slot } from './benefit18-layout'

/**
 * The הטבת 18 ₪ document: its own printed pages (the 18 ₪ agreement, then the
 * Tapuznet appendix — scripts/design/benefit18.ts), and the business's answers
 * in their boxes. Not the campaign's template: this track has its own terms.
 *
 * Read by path at runtime, like the signing font — next.config.ts carries
 * the assets folder into the function bundle.
 */
const PDF_PATH = join(process.cwd(), 'src/server/self-service/assets/benefit18.pdf')

export { BENEFIT18_PAGES }
export const BENEFIT18_DOCUMENT_NAME = 'הסכם שיתוף פעולה — הטבת 18 ₪'

export function benefit18Pdf(): Promise<Buffer> {
  return readFile(PDF_PATH)
}

/** True when an agreement belongs to the 18 ₪ track — read off its snapshot. */
export function isBenefit18(mergeSnapshot: unknown): boolean {
  return (mergeSnapshot as { values?: { withAppendix?: unknown } } | null)?.values?.withAppendix === true
}

function field(slot: Benefit18Slot, label: string, extra: Partial<PlacedField>): PlacedField {
  const at = BENEFIT18_SLOTS[slot]
  return {
    id: `b18-${slot}`,
    type: 'text',
    label: `הטבת 18 ₪ · ${label}`,
    ownedBy: 'sender',
    required: false,
    page: at.page,
    x: at.x,
    y: at.y,
    width: at.w,
    height: at.h,
    value: null,
    options: null,
    placeholder: null,
    autoFill: false,
    autoSource: null,
    variableKey: `b18_${slot}`,
    ...extra,
  }
}

/**
 * Every box of the document, filled from the form. Empty answers get no box —
 * an empty row is simply the printed empty row — so nothing optional stands
 * in a signature's way. One signature box on the agreement and one on the
 * appendix: the signing engine draws the same signature in both.
 */
export function benefit18Fields(data: RegistrationValues): PlacedField[] {
  const national = toIsraeliNationalFormat(data.phone)
  const phone = national ? `${national.slice(0, 3)}-${national.slice(3)}` : data.phone
  const shekels = (value: string) => (value ? `${value} ₪` : '')
  const address = [data.address, data.city].filter(Boolean).join(', ')
  const rows = SERVICE_ROW_FIELDS.map(([type, tourism, site]) => ({ type: data[type], tourism: shekels(data[tourism]), site: shekels(data[site]) }))
  const s = ['s1', 's2', 's3'] as const

  const text: [Benefit18Slot, string, string][] = [
    // The agreement.
    ['a_business_name', 'שם העסק / החברה', data.businessName],
    ['a_tax_id', 'מספר ח.פ.', data.taxId],
    ['a_commercial', 'שם העסק המסחרי', data.commercialName],
    ['a_email', 'דוא״ל', data.email],
    ['a_contact_phone', 'איש קשר + מס׳ טלפון', `${data.contactPerson}, ${phone}`],
    ['a_address', 'כתובת', address],
    ...rows.flatMap((row, i): [Benefit18Slot, string, string][] => [
      [`a_${s[i]}_type`, `הטבה ${i + 1} · סוג ההטבה`, row.type],
      [`a_${s[i]}_tourism`, `הטבה ${i + 1} · מחיר לטובת חודש התיירות`, row.tourism],
      [`a_${s[i]}_site`, `הטבה ${i + 1} · מחיר קבוע באתר`, row.site],
    ]),
    ['a_notes', 'הערות', data.benefitNotes],
    ['a_signatory', 'שם מלא של המורשה/ת לחתום', data.signatoryName],
    ['a_role', 'תפקיד', data.signatoryRole],
    // The appendix: the letter, the service table (the site's price is the
    // price list; the tourism-month price is what the business is paid per
    // voucher), the accounting form.
    ['letter_name', 'נספח · לכבוד', data.businessName],
    ['letter_address', 'נספח · כתובת', data.address],
    ['letter_city', 'נספח · עיר', data.city],
    ['letter_contact', 'נספח · לידי', data.contactPerson],
    ['letter_phone', 'נספח · טלפון', phone],
    ['clause_name', 'נספח · בית העסק', data.businessName],
    ...rows.flatMap((row, i): [Benefit18Slot, string, string][] => [
      [`${s[i]}_type`, `נספח · שורה ${i + 1} · סוג השירות/המוצר`, row.type],
      [`${s[i]}_price`, `נספח · שורה ${i + 1} · מחירון`, row.site],
      [`${s[i]}_net`, `נספח · שורה ${i + 1} · מחיר נטו ל־Xtra`, row.tourism],
    ]),
    ['form_company', 'נספח · שם החברה', data.businessName],
    ['form_contact', 'נספח · שם איש קשר', data.contactPerson],
    ['form_tax_id', 'נספח · ח.פ', data.taxId],
    ['form_mailing', 'נספח · כתובת למשלוח דואר', address],
    ['bank_account_name', 'נספח · שם החשבון', data.bankAccountName],
    ['bank_branch_name', 'נספח · שם סניף', data.bankBranchName],
    ['bank_account', 'נספח · מספר החשבון', data.bankAccount],
    ['bank_name', 'נספח · שם הבנק', data.bankName],
    ['bank_branch', 'נספח · מספר סניף', data.bankBranch],
    ['bank_number', 'נספח · מספר בנק', data.bankNumber],
    ['signatory_name', 'נספח · שם החותם', data.signatoryName],
  ]

  const ticks: [Benefit18Slot, string, boolean][] = [
    [`a_${data.week}`, 'שבוע התיירות האזורי', true],
    ['a_extension', 'הרחבה אופציונלית', data.optionalExtension],
    ['a_declare_license', 'רישיון עסק תקף כחוק', data.declareLicense],
    ['a_declare_insurance', 'פוליסת ביטוח בתוקף', data.declareInsurance],
  ]

  return [
    ...text.filter(([, , value]) => value.trim()).map(([slot, label, value]) => field(slot, label, { value, required: true })),
    ...ticks.filter(([, , on]) => on).map(([slot, label]) => field(slot, label, { type: 'checkbox', value: 'true' })),
    // Dated on the day it is signed.
    field('a_date', 'תאריך', { type: 'date', ownedBy: 'signer', autoFill: true, required: true }),
    field('letter_date', 'נספח · תאריך', { type: 'date', ownedBy: 'signer', autoFill: true, required: true }),
    field('sign_date', 'נספח · תאריך חתימה', { type: 'date', ownedBy: 'signer', autoFill: true, required: true }),
    field('a_signature', 'חתימת בית העסק', { type: 'signature', ownedBy: 'signer', required: true }),
    field('signature', 'נספח · חתימת בית העסק', { type: 'signature', ownedBy: 'signer', required: true }),
  ]
}
