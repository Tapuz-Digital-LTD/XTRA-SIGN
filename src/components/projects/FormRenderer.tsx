'use client'

import type { FormField } from '@/server/projects/form-schema'

/**
 * Renders a project form's fields — the one renderer behind the hosted page,
 * the embed and the builder's preview, so what is previewed is what a
 * supplier gets.
 *
 * Native inputs only: a <select> that is really a <select> scrolls, focuses
 * and reads aloud correctly on every phone without a line of our code.
 */

export type FormValues = Record<string, string | string[] | boolean>

const inputClass =
  'mt-1.5 h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base text-fg outline-none focus:border-brand'

function isLtr(field: FormField): boolean {
  return field.type === 'phone' || field.type === 'email' || field.type === 'number' || field.id === 'taxId'
}

export function FormRenderer({
  fields,
  values,
  errors = {},
  onChange,
}: {
  fields: FormField[]
  values: FormValues
  errors?: Record<string, string>
  onChange: (id: string, value: string | string[] | boolean) => void
}) {
  return (
    <>
      {fields
        .filter((field) => !field.hidden)
        .map((field) => {
          const error = errors[field.id]
          const describedBy =
            [field.helpText ? `${field.id}-help` : null, error ? `${field.id}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined

          const help = field.helpText ? (
            <span id={`${field.id}-help`} className="mt-1 block text-xs text-muted">
              {field.helpText}
            </span>
          ) : null
          const errorLine = error ? (
            <span id={`${field.id}-error`} role="alert" className="mt-1 block text-xs text-red-700">
              {error}
            </span>
          ) : null
          const labelText = (
            <span className="font-medium text-fg">
              {field.label}
              {field.required ? <span className="text-red-700"> *</span> : null}
            </span>
          )

          if (field.type === 'checkbox') {
            return (
              <div key={field.id} className="mb-4">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={values[field.id] === true}
                    onChange={(e) => onChange(field.id, e.target.checked)}
                    aria-describedby={describedBy}
                    className="mt-0.5 size-5 shrink-0"
                  />
                  <span>
                    {labelText}
                    {help}
                  </span>
                </label>
                {errorLine}
              </div>
            )
          }

          if (field.type === 'multiselect') {
            const chosen = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : []
            return (
              <fieldset key={field.id} className="mb-4" aria-describedby={describedBy}>
                <legend className="text-sm">{labelText}</legend>
                {help}
                <div className="mt-1.5 flex flex-col gap-1">
                  {(field.options ?? []).map((option) => (
                    <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-bg px-3.5 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={chosen.includes(option)}
                        onChange={(e) =>
                          onChange(
                            field.id,
                            e.target.checked ? [...chosen, option] : chosen.filter((v) => v !== option),
                          )
                        }
                        className="size-5 shrink-0"
                      />
                      {option}
                    </label>
                  ))}
                </div>
                {errorLine}
              </fieldset>
            )
          }

          if (field.type === 'select') {
            return (
              <label key={field.id} className="mb-4 block text-sm">
                {labelText}
                {help}
                <select
                  value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  required={field.required}
                  aria-describedby={describedBy}
                  className={inputClass}
                >
                  <option value="">{field.placeholder || 'בחירה…'}</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {errorLine}
              </label>
            )
          }

          if (field.type === 'textarea') {
            return (
              <label key={field.id} className="mb-4 block text-sm">
                {labelText}
                {help}
                <textarea
                  value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  required={field.required}
                  placeholder={field.placeholder}
                  rows={4}
                  aria-describedby={describedBy}
                  className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-base text-fg outline-none focus:border-brand"
                />
                {errorLine}
              </label>
            )
          }

          const htmlType =
            field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'text' : field.type === 'date' ? 'date' : 'text'
          return (
            <label key={field.id} className="mb-4 block text-sm">
              {labelText}
              {help}
              <input
                type={htmlType}
                value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
                onChange={(e) => onChange(field.id, e.target.value)}
                required={field.required}
                placeholder={field.placeholder}
                inputMode={field.type === 'phone' ? 'tel' : field.type === 'number' || field.id === 'taxId' ? 'numeric' : undefined}
                dir={isLtr(field) ? 'ltr' : undefined}
                aria-describedby={describedBy}
                className={inputClass}
              />
              {errorLine}
            </label>
          )
        })}
    </>
  )
}
