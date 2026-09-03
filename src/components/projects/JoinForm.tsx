'use client'

import { useEffect, useState } from 'react'
import { FormRenderer, type FormValues } from '@/components/projects/FormRenderer'
import type { LandingConfig } from '@/server/projects/landing'

/**
 * The public joining form. One column, big targets, no login — a supplier
 * standing in a parking lot with a phone must be able to finish it.
 *
 * In embed mode the same form runs inside an iframe on someone else's site:
 * it reports its height so the host page never shows an inner scrollbar, and
 * announces a successful submission so the host can react.
 */
export function JoinForm({ slug, config, embed = false }: { slug: string; config: LandingConfig; embed?: boolean }) {
  const [values, setValues] = useState<FormValues>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // The honeypot: hidden from people, irresistible to bots.
  const [website, setWebsite] = useState('')

  // Height reporting for the embed wrapper. The message carries a size and
  // nothing else, so broadcasting it is harmless.
  useEffect(() => {
    if (!embed || typeof window === 'undefined' || window.parent === window) return
    const post = () =>
      window.parent.postMessage(
        { type: 'xtra-form:height', height: document.documentElement.scrollHeight },
        '*',
      )
    post()
    const observer = new ResizeObserver(post)
    observer.observe(document.documentElement)
    return () => observer.disconnect()
  }, [embed])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const response = await fetch(`/api/join/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values,
          website,
          embed,
          // Inside the iframe, document.referrer is the page hosting the embed.
          referrer: embed ? document.referrer : null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השליחה נכשלה. נסו שוב.')
        setFieldErrors(data?.error?.fields ?? {})
        return
      }
      setDone(true)
      if (embed && window.parent !== window) {
        window.parent.postMessage({ type: 'xtra-form:submitted' }, '*')
      }
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
        <p role="status" className="mt-4 text-lg font-semibold text-fg">{config.successMessage}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 sm:p-8" noValidate>
      <FormRenderer
        fields={config.fields}
        values={values}
        errors={fieldErrors}
        onChange={(id, value) => {
          setValues((v) => ({ ...v, [id]: value }))
          setFieldErrors((current) => {
            if (!current[id]) return current
            const next = { ...current }
            delete next[id]
            return next
          })
        }}
      />

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
