import { normalizeIsraeliPhone } from '@/lib/phone'

/**
 * The project form's schema: what the joining form asks, as data.
 *
 * The schema is the single truth all three intake doors share — the hosted
 * page, the embed and the public API all validate against the same published
 * fields, in one place, server-side. It is stored on the project
 * (groups.landing_config) and a snapshot of it travels with every submission,
 * so a lead stays readable exactly as it was asked even after the form
 * changes.
 */

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'

export type FormField = {
  /** Stable identity. System fields use their fixed ids; custom ones `custom_*`. */
  id: string
  type: FormFieldType
  label: string
  required: boolean
  placeholder?: string
  helpText?: string
  /** For select / multiselect. */
  options?: string[]
  /** Kept in the schema but not shown or accepted. Never deleted data. */
  hidden?: boolean
}

/**
 * The fields that map onto a supplier record. Their ids are the exact keys
 * approveLead reads (data.name → supplier name, and so on), which is the whole
 * mapping: no lookup table can drift out of sync with it.
 */
export const SYSTEM_FIELDS: { id: string; label: string; type: FormFieldType; supplierField: string }[] = [
  { id: 'name', label: 'שם החברה', type: 'text', supplierField: 'שם הספק' },
  { id: 'taxId', label: 'ח.פ / ע.מ', type: 'text', supplierField: 'ח.פ / ע.מ' },
  { id: 'contactName', label: 'שם איש הקשר', type: 'text', supplierField: 'איש קשר' },
  { id: 'phone', label: 'טלפון', type: 'phone', supplierField: 'טלפון' },
  { id: 'email', label: 'אימייל', type: 'email', supplierField: 'אימייל' },
  { id: 'address', label: 'כתובת', type: 'text', supplierField: 'כתובת (בהערות)' },
  { id: 'city', label: 'עיר', type: 'text', supplierField: 'עיר (בהערות)' },
]

const SYSTEM_IDS = new Set(SYSTEM_FIELDS.map((f) => f.id))
const FIELD_TYPES: FormFieldType[] = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox']

export function isSystemField(id: string): boolean {
  return SYSTEM_IDS.has(id)
}

export const DEFAULT_FORM_FIELDS: FormField[] = [
  { id: 'name', type: 'text', label: 'שם החברה', required: true },
  { id: 'taxId', type: 'text', label: 'ח.פ / ע.מ', required: false },
  { id: 'contactName', type: 'text', label: 'שם איש הקשר', required: true },
  { id: 'phone', type: 'phone', label: 'טלפון', required: true },
  { id: 'email', type: 'email', label: 'אימייל', required: false },
  { id: 'address', type: 'text', label: 'כתובת', required: false },
  { id: 'city', type: 'text', label: 'עיר', required: false },
]

const MAX_FIELDS = 30
const MAX_OPTIONS = 30
const CUSTOM_ID_RE = /^custom_[a-z0-9_-]{1,40}$/

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * Normalises whatever is stored or sent into a valid field list.
 *
 * Accepts both today's shape and the V1 one ({key, label, required}), so a
 * form saved before the builder existed keeps working untouched. Anything
 * unrecognisable is dropped rather than guessed at.
 */
export function normalizeFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return DEFAULT_FORM_FIELDS.map((f) => ({ ...f }))

  const seen = new Set<string>()
  const fields: FormField[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>

    // V1 stored `key`; the builder stores `id`.
    const id = clean(entry.id ?? entry.key, 60)
    if (!id || seen.has(id)) continue
    if (!SYSTEM_IDS.has(id) && !CUSTOM_ID_RE.test(id)) continue

    const system = SYSTEM_FIELDS.find((f) => f.id === id)
    // A system field's type is fixed — its id IS its meaning.
    const rawType = clean(entry.type, 20) as FormFieldType
    const type = system ? system.type : FIELD_TYPES.includes(rawType) ? rawType : 'text'

    const needsOptions = type === 'select' || type === 'multiselect'
    const options = needsOptions
      ? (Array.isArray(entry.options) ? entry.options : [])
          .map((o) => clean(o, 60))
          .filter(Boolean)
          .slice(0, MAX_OPTIONS)
      : undefined
    if (needsOptions && (!options || options.length === 0)) continue

    fields.push({
      id,
      type,
      label: clean(entry.label, 60) || system?.label || id,
      required: Boolean(entry.required),
      placeholder: clean(entry.placeholder, 100) || undefined,
      helpText: clean(entry.helpText, 200) || undefined,
      options,
      hidden: Boolean(entry.hidden) || undefined,
    })
    seen.add(id)
    if (fields.length >= MAX_FIELDS) break
  }

  // A form that cannot produce a supplier name cannot produce a supplier.
  if (!fields.some((f) => f.id === 'name' && !f.hidden)) {
    fields.unshift({ ...DEFAULT_FORM_FIELDS[0] })
  }
  return fields
}

export type SubmissionResult =
  | { ok: true; data: Record<string, string> }
  | { ok: false; fields: Record<string, string> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates one hostile payload against the published fields.
 *
 * Only visible fields are accepted; anything else in the payload is ignored,
 * so a client can never smuggle keys the form does not ask for. Values are
 * normalised (email lowered, phone to E.164 when Israeli) and flattened to
 * strings — a multiselect stores its choices joined, a checkbox stores "כן".
 */
export function validateSubmission(fields: FormField[], values: Record<string, unknown>): SubmissionResult {
  const data: Record<string, string> = {}
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (field.hidden) continue
    const raw = values[field.id]

    if (field.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === 'on' || raw === 'כן'
      if (field.required && !checked) errors[field.id] = 'יש לסמן את השדה'
      if (checked) data[field.id] = 'כן'
      continue
    }

    if (field.type === 'multiselect') {
      const list = (Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => field.options?.includes(v))
      if (field.required && list.length === 0) errors[field.id] = 'יש לבחור לפחות אפשרות אחת'
      if (list.length > 0) data[field.id] = [...new Set(list)].join(', ')
      continue
    }

    const value = typeof raw === 'string' ? raw.trim().slice(0, field.type === 'textarea' ? 2000 : 300) : ''
    if (!value) {
      if (field.required) errors[field.id] = 'שדה חובה'
      continue
    }

    switch (field.type) {
      case 'email':
        if (!EMAIL_RE.test(value)) { errors[field.id] = 'כתובת אימייל לא תקינה'; continue }
        data[field.id] = value.toLowerCase()
        continue
      case 'phone':
        data[field.id] = normalizeIsraeliPhone(value) ?? value
        continue
      case 'number':
        if (!/^-?\d{1,15}([.,]\d{1,6})?$/.test(value)) { errors[field.id] = 'יש להזין מספר'; continue }
        data[field.id] = value.replace(',', '.')
        continue
      case 'date':
        if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors[field.id] = 'תאריך לא תקין'
          continue
        }
        data[field.id] = value
        continue
      case 'select':
        if (!field.options?.includes(value)) { errors[field.id] = 'יש לבחור מהרשימה'; continue }
        data[field.id] = value
        continue
      default:
        data[field.id] = value
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, fields: errors }
  return { ok: true, data }
}
