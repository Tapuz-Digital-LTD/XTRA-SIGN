'use client'

import { useState } from 'react'

/**
 * Setting a password — used by both invitation acceptance and password reset.
 *
 * The confirmation field is deliberate: a typo in a password nobody can see
 * locks someone out of an account they just created, and the only recovery is
 * another email round trip.
 */
export function PasswordForm({
  action,
  heading,
  subheading,
  submitLabel,
}: {
  action: (password: string) => Promise<{ ok: boolean; message?: string } | void>
  heading: string
  subheading?: string
  submitLabel: string
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && password !== confirm
  const ready = password.length >= 10 && password === confirm

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-center text-xl font-bold text-fg">{heading}</h1>
      {subheading ? (
        <p className="mt-1 text-center text-sm text-muted" dir="auto">
          {subheading}
        </p>
      ) : null}

      <form
        className="mt-8 flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          const result = await action(password)
          if (result && !result.ok) {
            setError(result.message ?? 'משהו השתבש. נסו שוב.')
            setBusy(false)
          }
          // On success the action redirects; leaving `busy` set avoids a flash
          // of an enabled button during navigation.
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-fg">
            סיסמה חדשה
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <p className="text-xs text-muted">לפחות 10 תווים</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-medium text-fg">
            אימות סיסמה
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            className={`min-h-11 rounded-lg border bg-surface px-3 text-sm ${
              mismatch ? 'border-danger' : 'border-line'
            }`}
          />
          {mismatch ? (
            <p role="alert" className="text-xs text-danger">
              הסיסמאות אינן זהות.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!ready || busy}
          className="mt-2 min-h-11 rounded-lg bg-brand text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'שומר…' : submitLabel}
        </button>
      </form>
    </div>
  )
}
