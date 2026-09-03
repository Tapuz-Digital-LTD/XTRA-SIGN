'use client'

import { useState } from 'react'
import type { LandingConfig } from '@/server/projects/landing'

/**
 * The public joining form. One column, big targets, no login — a supplier
 * standing in a parking lot with a phone must be able to finish it.
 */
export function JoinForm({ slug, config }: { slug: string; config: LandingConfig }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // The honeypot: hidden from people, irresistible to bots.
  const [website, setWebsite] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const response = await fetch(`/api/join/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values, website }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השליחה נכשלה. נסו שוב.')
        setFieldErrors(data?.error?.fields ?? {})
        return
      }
      setDone(true)
    } catch {
      setError('השליחה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700" aria-hidden="true">
          ✓
        </div>
        <p className="mt-4 text-lg font-semibold text-fg">{config.successMessage}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 sm:p-8">
      {config.fields.map((field) => {
        const ltr = field.key === 'phone' || field.key === 'email' || field.key === 'taxId'
        return (
          <label key={field.key} className="mb-4 block text-sm">
            <span className="font-medium text-fg">
              {field.label}
              {field.required ? <span className="text-red-700"> *</span> : null}
            </span>
            <input
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              required={field.required}
              type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
              inputMode={field.key === 'phone' ? 'tel' : field.key === 'taxId' ? 'numeric' : undefined}
              dir={ltr ? 'ltr' : undefined}
              className="mt-1.5 h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base text-fg outline-none focus:border-brand"
            />
            {fieldErrors[field.key] ? (
              <span role="alert" className="mt-1 block text-xs text-red-700">
                {fieldErrors[field.key]}
              </span>
            ) : null}
          </label>
        )
      })}

      {/* Never shown; a value here means a script filled the form. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="min-h-13 w-full rounded-xl bg-brand px-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'שולח…' : 'שליחת הפרטים'}
      </button>
    </form>
  )
}
