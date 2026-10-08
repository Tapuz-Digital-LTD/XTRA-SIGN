import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlacedField } from '@/lib/fields'
import { toIsraeliNationalFormat } from '@/lib/phone'
import { isBenefit18Values, SERVICE_ROW_FIELDS, type RegistrationValues } from '@/lib/self-service-registration'
import { BENEFIT18_PAGES, BENEFIT18_SLOTS, type Benefit18Slot } from './benefit18-layout'

/**
 * The הטבת 18 ₪ document: its own printed agreement (scripts/design/benefit18.ts)
 * and the business's answers in their boxes — what the form asked, and nothing
 * the form does not show. Not the campaign's template: this track has its own
 * terms.
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
  return isBenefit18Values((mergeSnapshot as { values?: { withAppendix?: unknown; redemption?: unknown } } | null)?.values)
}

function field(slot: Benefit18Slot, label: string, extra: Partial<PlacedField>): PlacedField {
  const measured = BENEFIT18_SLOTS[slot]
  // The field store makes every field at least 0.02 of the page and keeps its
  // corner, which would push a tick off a small printed box: a tick's field is
  // that minimum, centred on the box it marks.
  const at = extra.type === 'checkbox' ? { ...measured, x: measured.x + measured.w / 2 - 0.01, y: measured.y + measured.h / 2 - 0.01, w: 0.02, h: 0.02 } : measured
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
 * in a signature's way.
 */
export function benefit18Fields(data: RegistrationValues): PlacedField[] {
  const national = toIsraeliNationalFormat(data.phone)
  const phone = national ? `${national.slice(0, 3)}-${national.slice(3)}` : data.phone
  const shekels = (value: string) => (value ? `${value} ₪` : '')
  const s = ['s1', 's2', 's3'] as const

  const text: [Benefit18Slot, string, string][] = [
    ['a_business_name', 'שם העסק / החברה', data.businessName],
    ['a_tax_id', 'מספר ח.פ.', data.taxId],
    ['a_commercial', 'שם העסק המסחרי', data.commercialName],
    ['a_email', 'דוא״ל', data.email],
    ['a_contact_phone', 'איש קשר + מס׳ טלפון', `${data.contactPerson}, ${phone}`],
    ['a_address', 'כתובת', [data.address, data.city].filter(Boolean).join(', ')],
    ...SERVICE_ROW_FIELDS.flatMap(([type, tourism, site], i): [Benefit18Slot, string, string][] => [
      [`a_${s[i]}_type`, `הטבה ${i + 1} · סוג ההטבה`, data[type]],
      [`a_${s[i]}_tourism`, `הטבה ${i + 1} · מחיר לטובת חודש התיירות`, shekels(data[tourism])],
      [`a_${s[i]}_site`, `הטבה ${i + 1} · מחיר קבוע באתר`, shekels(data[site])],
    ]),
    ['a_notes', 'הערות', data.benefitNotes],
    ['a_bank_account_name', 'שם החשבון', data.bankAccountName],
    ['a_bank', 'הבנק', data.bankName ? `${data.bankName} (${data.bankNumber})` : ''],
    ['a_bank_branch', 'מספר סניף', data.bankBranch],
    ['a_bank_branch_name', 'שם הסניף', data.bankBranchName],
    ['a_bank_account', 'מספר החשבון', data.bankAccount],
    ['a_signatory', 'שם מלא של המורשה/ת לחתום', data.signatoryName],
    ['a_role', 'תפקיד', data.signatoryRole],
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
    field('a_signature', 'חתימת בית העסק', { type: 'signature', ownedBy: 'signer', required: true }),
  ]
}
