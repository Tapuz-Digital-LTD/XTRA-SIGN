'use client'

import { useEffect, useRef, useState } from 'react'
import { toIsraeliNationalFormat } from '@/lib/phone'
import type { EditorRecipient } from './FieldEditor'

/**
 * Who the document goes to.
 *
 * Autosaved like the fields, so the editor has no Save button anywhere. Server
 * validation is authoritative — this form does not pre-validate the phone,
 * because two different opinions about what a valid Israeli mobile is would
 * eventually disagree.
 */
export function RecipientForm({
  documentId,
  initial,
}: {
  documentId: string
  initial: EditorRecipient | null
}) {
  const [value, setValue] = useState<EditorRecipient>({
    name: initial?.name ?? '',
    company: initial?.company ?? '',
    // The server stores E.164 (+9725…). Showing that back is a technical
    // detail the user did not type; they see the 05… form they know.
    phone: toIsraeliNationalFormat(initial?.phone) ?? initial?.phone ?? '',
    email: initial?.email ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    // Nothing to save until there is a name; the server rejects an empty one
    // and an error message while someone is still typing is just noise.
    if (!value.name.trim()) return

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/recipient`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          setError(data?.error?.message ?? 'השמירה נכשלה.')
          setSaved(false)
          return
        }
        setError(null)
        setSaved(true)
      } catch {
        setError('השמירה נכשלה. בדקו את החיבור לאינטרנט.')
        setSaved(false)
      }
    }, 900)

    return () => clearTimeout(timer)
  }, [value, documentId])

  const field = (
    key: keyof EditorRecipient,
    label: string,
    type: string,
    dir?: 'ltr',
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`recipient-${key}`} className="text-xs font-medium text-fg">
        {label}
      </label>
      <input
        id={`recipient-${key}`}
        type={type}
        dir={dir}
        value={value[key] ?? ''}
        onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value }))}
        className="min-h-11 rounded-lg border border-line bg-white px-3 text-start text-sm"
      />
    </div>
  )

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">למי שולחים?</h2>

      <div className="mt-4 flex flex-col gap-3">
        {field('name', 'שם מלא', 'text')}
        {field('company', 'שם העסק', 'text')}
        {field('phone', 'טלפון', 'tel', 'ltr')}
        {field('email', 'אימייל', 'email', 'ltr')}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      ) : saved ? (
        <p role="status" aria-live="polite" className="mt-3 text-xs text-muted">
          נשמר
        </p>
      ) : null}
    </div>
  )
}
