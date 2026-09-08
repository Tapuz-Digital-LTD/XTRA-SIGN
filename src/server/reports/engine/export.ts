import ExcelJS from 'exceljs'
import type { StaffSession } from '@/server/auth/session'
import { iterateReport, labelFor } from './query'
import type { ReportDefinition } from './types'
import { ENTITY_LABELS } from './types'

/**
 * The report as a real .xlsx: Hebrew headers, readable dates in Israel time,
 * labels instead of codes, every matching row (up to the cap). Cells that
 * would read as a formula in Excel are neutralised. No message bodies, no
 * signing links, no secrets — the registry never exposes them.
 */

const dateFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Excel treats =, +, -, @ (and tab/CR) at the start of a cell as a formula: a leading apostrophe keeps it text. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export async function buildReportWorkbook(session: StaffSession, definition: ReportDefinition & { ids?: string[]; extraColumns?: string[] }): Promise<{ buffer: Buffer; rows: number }> {
  const columns = [...(definition.columns ?? []), ...(definition.extraColumns ?? [])].filter((c, i, all) => all.indexOf(c) === i)
  const book = new ExcelJS.Workbook()
  book.creator = 'XTRA Sign'
  const sheet = book.addWorksheet(ENTITY_LABELS[definition.entity]?.label.slice(0, 30) || 'דוח', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  let headerDone = false
  let count = 0
  for await (const page of iterateReport(session, { ...definition, columns })) {
    if (!headerDone) {
      sheet.columns = page.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === 'date' ? 18 : c.type === 'text' && /note|הער/.test(c.key) ? 40 : 22 }))
      sheet.getRow(1).font = { bold: true }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } }
      headerDone = true
    }
    for (const row of page.rows) {
      const record: Record<string, string> = {}
      for (const c of page.columns) {
        const v = row.cells[c.key]
        let text: string
        if (v === null || v === undefined) text = ''
        else if (c.type === 'date' && typeof v === 'string') {
          const d = new Date(v)
          text = Number.isNaN(d.getTime()) ? v : dateFormat.format(d)
        } else text = labelFor(c, v)
        record[c.key] = safeCell(text)
      }
      sheet.addRow(record)
      count++
    }
  }
  if (!headerDone) {
    sheet.columns = [{ header: 'אין רשומות שתואמות לתנאים', key: 'empty', width: 40 }]
  }
  const buffer = Buffer.from(await book.xlsx.writeBuffer())
  return { buffer, rows: count }
}
