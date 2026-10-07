import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audienceIncludes } from '@/lib/benefit18-appendix'
import type { PlacedField } from '@/lib/fields'
import { toIsraeliNationalFormat } from '@/lib/phone'
import { SERVICE_ROW_FIELDS, type RegistrationValues } from '@/lib/self-service-registration'
import { APPENDIX_PAGES, APPENDIX_SLOTS, type AppendixSlot } from './benefit18-appendix-layout'

/**
 * The 18 ₪ appendix in a document: its printed pages, appended after the
 * campaign agreement, and the business's answers in their boxes.
 *
 * Read by path at runtime, like the signing font — next.config.ts carries
 * the assets folder into the function bundle. A cwd-relative path, because
 * that is what the tracer and the font loader already agree on.
 */
const PDF_PATH = join(process.cwd(), 'src/server/self-service/assets/benefit18-appendix.pdf')

export { APPENDIX_PAGES }

export function appendixPdf(): Promise<Buffer> {
  return readFile(PDF_PATH)
}

/** True when an agreement was made with the appendix — read off its snapshot. */
export function hasAppendix(mergeSnapshot: unknown): boolean {
  return (mergeSnapshot as { values?: { withAppendix?: unknown } } | null)?.values?.withAppendix === true
}

const LABEL = 'נספח הטבת 18 ₪'

function field(slot: AppendixSlot, firstPage: number, label: string, extra: Partial<PlacedField>): PlacedField {
  const at = APPENDIX_SLOTS[slot]
  return {
    id: `b18-${slot}`,
    type: 'text',
    label: `${LABEL} · ${label}`,
    ownedBy: 'sender',
    required: false,
    page: firstPage + at.page - 1,
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
 * Every box of the appendix, filled from the form. `firstPage` is where the
 * appendix starts in the document (the agreement's own pages come first).
 * Empty answers get no box — an empty row of the service table is simply
 * the printed empty row — so nothing optional can stand in a signature's way.
 */
export function appendixFields(data: RegistrationValues, firstPage: number): PlacedField[] {
  const national = toIsraeliNationalFormat(data.phone)
  const phone = national ? `${national.slice(0, 3)}-${national.slice(3)}` : data.phone
  const shekels = (value: string) => (value ? `${value} ₪` : '')

  const text: [AppendixSlot, string, string][] = [
    ['letter_name', 'לכבוד', data.businessName],
    ['letter_address', 'כתובת', data.address],
    ['letter_city', 'עיר', data.city],
    ['letter_contact', 'לידי', data.contactPerson],
    ['letter_phone', 'טלפון', phone],
    ['clause_name', 'בית העסק', data.businessName],
    ...SERVICE_ROW_FIELDS.flatMap(([type, details, price, net], i): [AppendixSlot, string, string][] => {
      const row = (['s1', 's2', 's3'] as const)[i]
      return [
        [`${row}_type`, `שורה ${i + 1} · סוג השירות/המוצר`, data[type]],
        [`${row}_details`, `שורה ${i + 1} · פירוט`, data[details]],
        [`${row}_price`, `שורה ${i + 1} · מחירון`, shekels(data[price])],
        [`${row}_net`, `שורה ${i + 1} · מחיר נטו ל־Xtra`, shekels(data[net])],
      ]
    }),
    ['form_company', 'שם החברה', data.businessName],
    ['form_contact', 'שם איש קשר', data.contactPerson],
    ['form_tax_id', 'ח.פ', data.taxId],
    ['form_mailing', 'כתובת למשלוח דואר', [data.address, data.city].filter(Boolean).join(', ')],
    ['bank_account_name', 'שם החשבון', data.bankAccountName],
    ['bank_branch_name', 'שם סניף', data.bankBranchName],
    ['bank_account', 'מספר החשבון', data.bankAccount],
    ['bank_name', 'שם הבנק', data.bankName],
    ['bank_branch', 'מספר סניף', data.bankBranch],
    ['bank_number', 'מספר בנק', data.bankNumber],
    ['signatory_name', 'שם החותם', data.signatoryName],
  ]

  return [
    ...text.filter(([, , value]) => value.trim()).map(([slot, label, value]) => field(slot, firstPage, label, { value, required: true })),
    ...(['business', 'private'] as const)
      .filter((id) => audienceIncludes(data.audience, id))
      .map((id) => field(`audience_${id}`, firstPage, id === 'business' ? 'לקהל ארגוני עסקי' : 'חנות לפרטיים', { type: 'checkbox', value: 'true' })),
    // Dated on the day it is signed, like the agreement's own date.
    field('letter_date', firstPage, 'תאריך', { type: 'date', ownedBy: 'signer', autoFill: true, required: true }),
    field('sign_date', firstPage, 'תאריך חתימה', { type: 'date', ownedBy: 'signer', autoFill: true, required: true }),
    field('signature', firstPage, 'חתימת בית העסק', { type: 'signature', ownedBy: 'signer', required: true }),
  ]
}
