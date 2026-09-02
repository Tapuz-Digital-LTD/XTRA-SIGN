'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Creates a group, optionally seeded from a selection elsewhere. */
export function NewGroupButton({
  companyIds,
  label = '+ קבוצה חדשה',
  /** Preselected when the button sits on a suppliers or customers screen. */
  defaultKind = null,
}: {
  companyIds?: string[]
  label?: string
  defaultKind?: 'supplier' | 'customer' | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'supplier' | 'customer'>(defaultKind ?? 'supplier')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null, kind, companyIds }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        return
      }
      router.push(`/groups/${data.id}`)
    } catch {
      setError('היצירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <h2 className="text-base font-semibold text-fg">קבוצה חדשה</h2>
        {companyIds?.length ? (
          <p className="mt-1 text-sm text-muted">
            {companyIds.length === 1 ? 'חברה אחת תיכלל' : `${companyIds.length} חברות ייכללו`} בקבוצה.
          </p>
        ) : null}

        <label className="mt-4 block text-sm">
          <span className="text-muted">
            שם הקבוצה <span className="text-red-700">*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="למשל: ספקי פסח 2026"
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <fieldset className="mt-4">
          <legend className="text-sm text-muted">הקבוצה מיועדת ל־</legend>
          {/* Suppliers and customers get different agreements, so a group holds
              one or the other and the send screens stay uncluttered. */}
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(
              [
                { value: 'supplier', label: 'ספקים' },
                { value: 'customer', label: 'לקוחות' },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm transition ${
                  kind === option.value
                    ? 'border-brand bg-blue-50 font-medium text-fg'
                    : 'border-line bg-surface text-muted hover:border-brand'
                }`}
              >
                <input
                  type="radio"
                  name="group-kind"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => setKind(option.value)}
                  className="size-4"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 block text-sm">
          <span className="text-muted">תיאור</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>

        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="min-h-11 flex-1 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'יוצר…' : 'יצירת קבוצה'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-lg border border-line bg-surface px-4 text-sm text-fg"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  )
}
