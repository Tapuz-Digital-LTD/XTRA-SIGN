import { REGISTRATION_LABELS, TOURISM_WEEKS, type RegistrationField } from './self-service-registration'

/**
 * A form's answers as columns a person may add to a campaign's tables.
 *
 * Every campaign asks its own questions, so no answer is a column by default:
 * a project picks which ones its people want beside the name (the server's
 * list-columns.ts keeps the choice), and that one list drives the tables on
 * screen, the Excel file and the report engine's "טופס:" fields. `options`
 * turn a stored code into the words the form showed.
 */
export type FormColumn = { key: string; label: string; options?: Record<string, string> }

export const YES_NO: Record<string, string> = { true: 'כן', false: 'לא' }

/** The self-service form's answers beyond what every table already shows (name, ח.פ., contact, phone, email). */
export const TOURISM_FORM_COLUMNS: FormColumn[] = (
  [
    ['commercialName'],
    ['contactPerson'],
    ['signatoryRole'],
    ['benefit1'],
    ['benefit2'],
    ['benefit3'],
    ['benefitNotes'],
    ['week', Object.fromEntries(TOURISM_WEEKS.map((w) => [w.id, w.title]))],
    ['redemption', { generic_xtra25: 'קוד גנרי XTRA25', business_pos_code: 'קוד קופון על פי קופת בית העסק' }],
    ['couponCode'],
    ['optionalExtension', YES_NO],
    ['declareLicense', YES_NO],
    ['declareInsurance', YES_NO],
  ] as [RegistrationField, Record<string, string>?][]
).map(([key, options]) => ({ key, label: REGISTRATION_LABELS[key], ...(options ? { options } : {}) }))

/** The stored answer in the form's own words. */
export function formatAnswer(column: FormColumn, value: string | undefined): string {
  if (!value) return ''
  return column.options?.[value] ?? value
}

/**
 * Every answer a registration holds, as text by key: the agreement's frozen
 * snapshot first (the whole form), the lead row on top (what it keeps, and
 * what a person edited since). Codes stay codes — formatAnswer says them.
 */
export function answersOf(data: unknown, snapshot: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const source of [snapshot, data]) {
    if (!source || typeof source !== 'object') continue
    for (const [key, v] of Object.entries(source as Record<string, unknown>)) {
      const text = Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'boolean' || typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''
      if (text.trim()) out[key] = text
    }
  }
  return out
}
