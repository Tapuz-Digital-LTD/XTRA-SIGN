import ExcelJS from 'exceljs'
import { validateCompanyFields } from '@/lib/company-validation'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { createCompany, type CompanyKind } from '@/server/companies/companies'
import { findLocalDuplicate } from '@/server/companies/duplicates'
import { addCompanies } from '@/server/groups/groups'

/**
 * Bringing suppliers and customers in from a spreadsheet, and back out again.
 *
 * The import never writes on upload. A file is parsed, checked and shown back
 * as a plan — valid, already-here, or rejected with the reason — and only a
 * separate confirmation writes anything. Somebody's supplier list is not the
 * place to find out afterwards what the system decided to do with it.
 *
 * Duplicates reuse the rule the rest of the system uses: tax id, then email,
 * then phone, then name. A row that matches an existing company is not a new
 * company; when the import came from a group, it joins that group instead.
 */

const HEADERS = ['סוג', 'שם חברה', 'ח.פ / ע.מ', 'שם איש קשר', 'טלפון', 'אימייל'] as const

export type ImportRowStatus = 'new' | 'existing' | 'invalid'

export type ImportRow = {
  line: number
  kind: CompanyKind
  name: string
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  status: ImportRowStatus
  /** For 'existing', the company it matched; for 'invalid', why. */
  existingId: string | null
  existingName: string | null
  message: string | null
}

/** A filled-in example plus instructions, so the file explains itself. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('ספקים ולקוחות', { views: [{ rightToLeft: true }] })

  sheet.columns = [
    { header: HEADERS[0], key: 'kind', width: 12 },
    { header: HEADERS[1], key: 'name', width: 32 },
    { header: HEADERS[2], key: 'taxId', width: 16 },
    { header: HEADERS[3], key: 'contactName', width: 22 },
    { header: HEADERS[4], key: 'contactPhone', width: 18 },
    { header: HEADERS[5], key: 'contactEmail', width: 28 },
  ]

  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } }
  sheet.addRow({
    kind: 'ספק',
    name: 'מקדונלדס ישראל',
    taxId: '512345678',
    contactName: 'ישראל ישראלי',
    contactPhone: '050-1234567',
    contactEmail: 'israel@example.com',
  })

  const notes = book.addWorksheet('הוראות', { views: [{ rightToLeft: true }] })
  notes.columns = [{ width: 90 }]
  for (const line of [
    'איך למלא את הקובץ',
    '',
    '1. מלאו שורה אחת לכל ספק או לקוח, בגיליון "ספקים ולקוחות".',
    '2. "סוג" חייב להיות ספק או לקוח.',
    '3. "שם חברה" הוא שדה חובה. שאר השדות מומלצים אך לא חובה.',
    '4. טלפון בפורמט ישראלי, למשל 050-1234567.',
    '5. אפשר למחוק את שורת הדוגמה.',
    '',
    'לפני הייבוא תוצג טבלת בדיקה: מה ייווצר, מה כבר קיים, ומה נדחה ולמה.',
    'חברה שכבר קיימת במערכת לא תיווצר פעמיים.',
  ]) {
    notes.addRow([line])
  }
  notes.getRow(1).font = { bold: true, size: 14 }

  return Buffer.from(await book.xlsx.writeBuffer())
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    const text = (v as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text.trim() : null
  }
  const t = String(v).trim()
  return t === '' ? null : t
}

/** Parses and checks, writing nothing. */
export async function parseImport(session: StaffSession, file: Buffer): Promise<ImportRow[]> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(file as unknown as ArrayBuffer)
  const sheet = book.worksheets[0]
  if (!sheet) return []

  const rows: ImportRow[] = []

  for (let i = 2; i <= Math.min(sheet.rowCount, 2000); i++) {
    const row = sheet.getRow(i)
    const kindRaw = str(row.getCell(1).value)
    const name = str(row.getCell(2).value)
    const taxId = str(row.getCell(3).value)
    const contactName = str(row.getCell(4).value)
    const contactPhoneRaw = str(row.getCell(5).value)
    const contactEmail = str(row.getCell(6).value)

    if (!kindRaw && !name && !taxId && !contactName && !contactPhoneRaw && !contactEmail) continue

    const kind: CompanyKind = kindRaw?.includes('לקוח') ? 'customer' : 'supplier'
    const contactPhone = contactPhoneRaw ? normalizeIsraeliPhone(contactPhoneRaw) ?? contactPhoneRaw : null

    const base = {
      line: i,
      kind,
      name: name ?? '',
      taxId,
      contactName,
      contactPhone,
      contactEmail,
      existingId: null as string | null,
      existingName: null as string | null,
    }

    const errors = validateCompanyFields({ name: name ?? '', taxId, contactPhone: contactPhoneRaw, contactEmail })
    const firstError = Object.values(errors)[0]
    if (firstError) {
      rows.push({ ...base, status: 'invalid', message: firstError })
      continue
    }

    const existing = await findLocalDuplicate(session, { name: name!, taxId, contactPhone, contactEmail })
    if (existing) {
      rows.push({
        ...base,
        status: 'existing',
        existingId: existing.id,
        existingName: existing.name,
        message: 'כבר קיימת — נשתמש בחברה הקיימת',
      })
      continue
    }

    rows.push({ ...base, status: 'new', message: null })
  }

  return rows
}

export type ImportOutcome = { created: number; linked: number; skipped: number }

/** Applies a plan the user has already seen. */
export async function applyImport(input: {
  session: StaffSession
  rows: ImportRow[]
  /** When set, everything imported or matched joins this group. */
  groupId?: string | null
}): Promise<ImportOutcome> {
  let created = 0
  let linked = 0
  let skipped = 0
  const toGroup: string[] = []

  for (const row of input.rows) {
    if (row.status === 'invalid') {
      skipped += 1
      continue
    }
    if (row.status === 'existing' && row.existingId) {
      linked += 1
      toGroup.push(row.existingId)
      continue
    }

    const result = await createCompany({
      session: input.session,
      kind: row.kind,
      data: {
        name: row.name,
        taxId: row.taxId,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        notes: null,
        crmRecordId: null,
      },
    })
    if (result.ok) {
      created += 1
      toGroup.push(result.id)
    } else {
      skipped += 1
    }
  }

  if (input.groupId && toGroup.length > 0) {
    await addCompanies({ session: input.session, groupId: input.groupId, companyIds: toGroup })
  }

  return { created, linked, skipped }
}

export type ExportRow = {
  name: string
  kind: CompanyKind
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  fromCrm: boolean
  groups?: string[]
}

/** Exactly the rows the caller asked for — never the whole database. */
export async function buildExportWorkbook(rows: ExportRow[], title: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(title.slice(0, 30) || 'ייצוא', { views: [{ rightToLeft: true }] })

  sheet.columns = [
    { header: 'שם', key: 'name', width: 32 },
    { header: 'סוג', key: 'kind', width: 10 },
    { header: 'ח.פ / ע.מ', key: 'taxId', width: 16 },
    { header: 'איש קשר', key: 'contactName', width: 22 },
    { header: 'טלפון', key: 'contactPhone', width: 18 },
    { header: 'אימייל', key: 'contactEmail', width: 28 },
    { header: 'מקור', key: 'source', width: 12 },
    { header: 'קבוצות', key: 'groups', width: 34 },
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } }

  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      kind: row.kind === 'supplier' ? 'ספק' : 'לקוח',
      taxId: row.taxId ?? '',
      contactName: row.contactName ?? '',
      contactPhone: row.contactPhone ?? '',
      contactEmail: row.contactEmail ?? '',
      source: row.fromCrm ? 'Fireberry' : 'XTRA Sign',
      groups: row.groups?.join(', ') ?? '',
    })
  }

  return Buffer.from(await book.xlsx.writeBuffer())
}
