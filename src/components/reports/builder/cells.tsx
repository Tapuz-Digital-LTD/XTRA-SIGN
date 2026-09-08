import type { FieldMeta, ReportRow } from '@/server/reports/engine/types'

export type Cell = ReportRow['cells'][string]

const dateTime = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/** A cell as text — what a card, a drawer and a title all use. */
export function cellText(field: FieldMeta | undefined, value: Cell): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'כן' : 'לא'
  if (Array.isArray(value)) return value.join(', ')
  if (field?.type === 'date' && typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return value.length <= 10 ? dateOnly.format(date) : dateTime.format(date)
  }
  if (field?.type === 'enum') return field.options?.find((o) => o.value === String(value))?.label ?? String(value)
  if (typeof value === 'number') return value.toLocaleString('he-IL')
  return String(value)
}

const isUrl = (value: Cell): value is string => typeof value === 'string' && /^https?:\/\//i.test(value)

/** A cell the way the table shows it: chips for lists, a link for a URL, כן/לא, a Hebrew date. */
export function CellView({ field, value }: { field: FieldMeta | undefined; value: Cell }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return <span className="text-muted">—</span>
  if (Array.isArray(value))
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span key={`${item}-${i}`} className="inline-flex max-w-40 truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-800">
            {item}
          </span>
        ))}
      </span>
    )
  if (isUrl(value))
    return (
      <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand underline-offset-4 hover:underline" dir="ltr">
        {value.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    )
  return <>{cellText(field, value)}</>
}
