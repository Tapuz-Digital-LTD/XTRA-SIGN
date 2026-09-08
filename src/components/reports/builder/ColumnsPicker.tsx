'use client'

import { useState } from 'react'
import type { FieldMeta } from '@/server/reports/engine/types'
import { Dialog } from './Dialog'
import { btnLink, btnSecondary, defaultColumns, fieldClass } from './shared'

/**
 * Which columns, in which order. A searchable checklist by group on one
 * side, the chosen ones with ↑↓ on the other; "איפוס" goes back to what
 * the entity shows by default.
 */
export function ColumnsPicker({ fields, columns, onChange }: { fields: FieldMeta[]; columns: string[]; onChange: (columns: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const groups = new Map<string, FieldMeta[]>()
  for (const field of fields) if (!q || field.label.toLowerCase().includes(q)) groups.set(field.group, [...(groups.get(field.group) ?? []), field])
  const chosen = columns.map((key) => fields.find((f) => f.key === key)).filter((f): f is FieldMeta => Boolean(f))

  const move = (index: number, delta: number) => {
    const next = [...columns]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary} data-testid="columns-button">
        עמודות ({columns.length})
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="עמודות הדוח"
        wide
        footer={
          <>
            <button type="button" onClick={() => onChange(defaultColumns(fields))} className={btnLink}>
              איפוס לברירת מחדל
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              סיום
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">סמנו מה יופיע בדוח; מימין אפשר לסדר את העמודות.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="columns-search" className="sr-only">
              חיפוש עמודה
            </label>
            <input id="columns-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש עמודה…" className={fieldClass} />
            <div className="mt-2 max-h-80 overflow-y-auto pe-1">
              {[...groups.entries()].map(([group, items]) => (
                <fieldset key={group} className="mb-3">
                  <legend className="mb-1 text-xs font-semibold text-muted">{group}</legend>
                  {items.map((field) => {
                    const on = columns.includes(field.key)
                    return (
                      <label key={field.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-bg">
                        <input type="checkbox" checked={on} onChange={() => onChange(on ? columns.filter((c) => c !== field.key) : [...columns, field.key])} className="size-4" />
                        <span className="min-w-0 flex-1">
                          {field.label}
                          {field.campaignsNote ? <span className="block text-xs text-muted">{field.campaignsNote}</span> : null}
                        </span>
                      </label>
                    )
                  })}
                </fieldset>
              ))}
              {groups.size === 0 ? <p className="text-sm text-muted">לא נמצאה עמודה בשם הזה.</p> : null}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted">הסדר בדוח ({chosen.length})</div>
            <ol className="mt-2 max-h-80 overflow-y-auto">
              {chosen.map((field, index) => (
                <li key={field.key} className="flex min-h-11 items-center gap-1 border-b border-line text-sm text-fg last:border-b-0">
                  <span className="min-w-0 flex-1 truncate">{field.label}</span>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`העברת ${field.label} למעלה`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted hover:bg-bg disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === chosen.length - 1} aria-label={`העברת ${field.label} למטה`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted hover:bg-bg disabled:opacity-30">
                    ↓
                  </button>
                  <button type="button" onClick={() => onChange(columns.filter((c) => c !== field.key))} aria-label={`הסרת ${field.label}`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-danger">
                    ✕
                  </button>
                </li>
              ))}
              {chosen.length === 0 ? <li className="py-2 text-sm text-muted">עדיין לא נבחרו עמודות.</li> : null}
            </ol>
          </div>
        </div>
      </Dialog>
    </>
  )
}
