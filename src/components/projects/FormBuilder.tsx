'use client'

import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FormRenderer, type FormValues } from '@/components/projects/FormRenderer'
import { SYSTEM_FIELDS, isSystemField, type FormField, type FormFieldType } from '@/server/projects/form-schema'

/**
 * The form builder: a list of fields and a live preview of the same renderer
 * the public page uses — what you see here is what a supplier gets.
 *
 * Deliberately not a canvas. Add, edit, reorder with arrows, hide, delete.
 * A person who has never heard the word "schema" should manage this.
 */

export const TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'טקסט קצר',
  textarea: 'טקסט ארוך',
  email: 'אימייל',
  phone: 'טלפון',
  number: 'מספר',
  date: 'תאריך',
  select: 'בחירה מרשימה',
  multiselect: 'בחירה מרובה',
  checkbox: 'תיבת סימון',
}

const CUSTOM_TYPES: FormFieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'phone']

function newId(): string {
  return `custom_${Math.random().toString(36).slice(2, 10)}`
}

export function FormBuilder({ fields, onChange }: { fields: FormField[]; onChange: (fields: FormField[]) => void }) {
  const [tab, setTab] = useState<'fields' | 'preview'>('fields')
  const [editing, setEditing] = useState<FormField | null>(null)
  const [adding, setAdding] = useState(false)
  const [previewValues, setPreviewValues] = useState<FormValues>({})

  const unusedSystem = SYSTEM_FIELDS.filter((s) => !fields.some((f) => f.id === s.id))

  function update(field: FormField) {
    onChange(fields.map((f) => (f.id === field.id ? field : f)))
  }

  function move(id: string, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function remove(id: string) {
    if (isSystemField(id)) return
    if (!window.confirm('למחוק את השדה מהטופס? פניות שכבר התקבלו ישמרו את התשובה.')) return
    onChange(fields.filter((f) => f.id !== id))
  }

  const list = (
    <ul className="flex flex-col gap-1.5">
      {fields.map((field, index) => (
        <li
          key={field.id}
          className={`flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 ${
            field.hidden ? 'border-dashed border-line bg-bg opacity-60' : 'border-line bg-bg'
          }`}
        >
          <span className="min-w-32 flex-1">
            <span className="block truncate text-sm font-medium text-fg">
              {field.label}
              {field.required ? <span className="text-red-700"> *</span> : null}
            </span>
            <span className="block text-xs text-muted">
              {TYPE_LABELS[field.type]}
              {isSystemField(field.id) ? ' · ממלא את כרטיס הספק' : ''}
              {field.hidden ? ' · מוסתר' : ''}
            </span>
          </span>
          <span className="ms-auto flex shrink-0 items-center">
            <button type="button" onClick={() => move(field.id, -1)} disabled={index === 0} aria-label={`העברת ${field.label} למעלה`} className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg disabled:opacity-30">
              <ChevronUp className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => move(field.id, 1)} disabled={index === fields.length - 1} aria-label={`העברת ${field.label} למטה`} className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg disabled:opacity-30">
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => update({ ...field, hidden: !field.hidden })} aria-label={field.hidden ? `הצגת ${field.label}` : `הסתרת ${field.label}`} className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg">
              {field.hidden ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => setEditing(field)} aria-label={`עריכת ${field.label}`} className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg">
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            {!isSystemField(field.id) ? (
              <button type="button" onClick={() => remove(field.id)} aria-label={`מחיקת ${field.label}`} className="inline-flex size-9 items-center justify-center rounded-lg text-red-700 transition hover:bg-red-50">
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )

  const preview = (
    <div className="rounded-xl border border-line bg-bg p-4">
      <p className="mb-3 text-xs font-medium text-muted">כך הטופס ייראה לספק:</p>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <FormRenderer
          fields={fields}
          values={previewValues}
          onChange={(id, value) => setPreviewValues((v) => ({ ...v, [id]: value }))}
        />
        <button type="button" disabled className="min-h-12 w-full cursor-default rounded-xl bg-brand px-4 text-base font-semibold text-white opacity-60">
          שליחת הפרטים
        </button>
      </div>
    </div>
  )

  return (
    <div>
      {/* On a phone the list and the preview take turns; on desktop, side by side. */}
      <div className="mb-3 flex gap-1 rounded-lg bg-bg p-1 lg:hidden" role="tablist" aria-label="עורך הטופס">
        {(
          [
            { key: 'fields', label: 'שדות' },
            { key: 'preview', label: 'תצוגה מקדימה' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-10 flex-1 rounded-md text-sm transition ${
              tab === t.key ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={tab === 'fields' ? '' : 'hidden lg:block'}>
          {list}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-line bg-surface px-4 text-sm font-medium text-muted transition hover:border-brand hover:text-fg"
          >
            <Plus className="size-4" aria-hidden="true" />
            הוסף שדה
          </button>
        </div>
        <div className={tab === 'preview' ? '' : 'hidden lg:block'}>{preview}</div>
      </div>

      {adding ? (
        <AddFieldDialog
          unusedSystem={unusedSystem}
          onClose={() => setAdding(false)}
          onAdd={(field) => {
            onChange([...fields, field])
            setAdding(false)
            setEditing(field)
          }}
        />
      ) : null}

      {editing ? (
        <EditFieldDialog
          field={fields.find((f) => f.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
          onSave={(field) => {
            update(field)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function AddFieldDialog({
  unusedSystem,
  onClose,
  onAdd,
}: {
  unusedSystem: typeof SYSTEM_FIELDS
  onClose: () => void
  onAdd: (field: FormField) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="הוספת שדה">
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <h3 className="text-base font-semibold text-fg">איזה שדה להוסיף?</h3>

        {unusedSystem.length > 0 ? (
          <>
            <p className="mt-3 text-xs font-medium text-muted">פרטי ספק — ימלאו את כרטיס הספק אוטומטית באישור הליד</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {unusedSystem.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onAdd({ id: s.id, type: s.type, label: s.label, required: false })}
                  className="min-h-11 rounded-lg border border-line bg-bg px-3 text-sm text-fg transition hover:border-brand"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <p className="mt-4 text-xs font-medium text-muted">שדה מותאם אישית — נשמר עם הליד ומוצג בכרטיס שלו</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {CUSTOM_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() =>
                onAdd({
                  id: newId(),
                  type,
                  label: TYPE_LABELS[type],
                  required: false,
                  options: type === 'select' || type === 'multiselect' ? ['אפשרות 1', 'אפשרות 2'] : undefined,
                })
              }
              className="min-h-11 rounded-lg border border-line bg-bg px-3 text-sm text-fg transition hover:border-brand"
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm text-fg">
          ביטול
        </button>
      </div>
    </div>
  )
}

function EditFieldDialog({
  field,
  onClose,
  onSave,
}: {
  field: FormField
  onClose: () => void
  onSave: (field: FormField) => void
}) {
  const [label, setLabel] = useState(field.label)
  const [required, setRequired] = useState(field.required)
  const [placeholder, setPlaceholder] = useState(field.placeholder ?? '')
  const [helpText, setHelpText] = useState(field.helpText ?? '')
  const [options, setOptions] = useState((field.options ?? []).join('\n'))
  const needsOptions = field.type === 'select' || field.type === 'multiselect'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="עריכת שדה">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const parsedOptions = options
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean)
            .slice(0, 30)
          if (needsOptions && parsedOptions.length === 0) return
          onSave({
            ...field,
            label: label.trim().slice(0, 60) || field.label,
            required,
            placeholder: placeholder.trim().slice(0, 100) || undefined,
            helpText: helpText.trim().slice(0, 200) || undefined,
            options: needsOptions ? parsedOptions : undefined,
          })
        }}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
      >
        <h3 className="text-base font-semibold text-fg">עריכת שדה — {TYPE_LABELS[field.type]}</h3>
        {isSystemField(field.id) ? (
          <p className="mt-1 text-xs text-muted">שדה פרטי ספק: התשובה תמלא את כרטיס הספק אוטומטית באישור הליד.</p>
        ) : null}

        <label className="mt-4 block text-sm">
          <span className="text-muted">כותרת השדה <span className="text-red-700">*</span></span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
        </label>

        {field.type !== 'checkbox' ? (
          <label className="mt-3 block text-sm">
            <span className="text-muted">{field.type === 'select' ? 'טקסט ברירת המחדל' : 'Placeholder (רשות)'}</span>
            <input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
          </label>
        ) : null}

        <label className="mt-3 block text-sm">
          <span className="text-muted">טקסט עזרה (רשות)</span>
          <input value={helpText} onChange={(e) => setHelpText(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand" />
        </label>

        {needsOptions ? (
          <label className="mt-3 block text-sm">
            <span className="text-muted">אפשרויות — אחת בכל שורה <span className="text-red-700">*</span></span>
            <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={4} required className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </label>
        ) : null}

        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-5" />
          שדה חובה
        </label>

        <div className="mt-4 flex gap-2">
          <button type="submit" className="min-h-11 flex-1 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90">
            שמירת השדה
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm text-fg">
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
