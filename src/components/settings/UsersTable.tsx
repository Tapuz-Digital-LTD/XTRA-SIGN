'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { UserRow, UserRole } from '@/server/users/users'

/**
 * The user list.
 *
 * One table and one button. The only actions are the ones that exist:
 * invite, disable, and switch between the two roles.
 */
export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[]
  currentUserId: string
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function call(path: string, body: unknown, id?: string) {
    setBusyId(id ?? 'invite')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setInviting((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">
            +
          </span>
          הוספת משתמש
        </button>
      </div>

      {inviting ? (
        <form
          className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const ok = await call('/api/users/invite', {
              name: form.get('name'),
              email: form.get('email'),
              role: form.get('role'),
            })
            if (ok) {
              setInviting(false)
              setNotice('ההזמנה נשלחה. המשתמש יגדיר סיסמה בעצמו.')
            }
          }}
        >
          <h2 className="text-sm font-semibold text-fg">הזמנת משתמש</h2>
          <p className="mt-1 text-xs text-muted">
            נשלח קישור להגדרת סיסמה. סיסמה לא נשלחת במייל.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field name="name" label="שם מלא" type="text" />
            <Field name="email" label="אימייל" type="email" dir="ltr" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-xs font-medium text-fg">
                הרשאה
              </label>
              <select
                id="role"
                name="role"
                defaultValue="user"
                className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
              >
                <option value="user">משתמש</option>
                <option value="admin">מנהל מערכת</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={busyId === 'invite'}
              className="min-h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busyId === 'invite' ? 'שולח…' : 'שליחת הזמנה'}
            </button>
            <button
              type="button"
              onClick={() => setInviting(false)}
              className="min-h-11 rounded-lg border border-line bg-white px-5 text-sm text-fg"
            >
              ביטול
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm text-fg">
          {notice}
        </p>
      ) : null}

      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">
                {user.name}
                {user.id === currentUserId ? (
                  <span className="ms-2 text-xs font-normal text-muted">(אתם)</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted" dir="ltr">
                {user.email}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status carried by a word, never by colour alone. */}
              {user.disabled ? (
                <Badge tone="danger">מושבת</Badge>
              ) : user.pending ? (
                <Badge tone="pending">ממתין לאישור</Badge>
              ) : (
                <Badge tone="success">פעיל</Badge>
              )}

              <select
                aria-label={`הרשאה של ${user.name}`}
                value={user.role}
                disabled={busyId === user.id || user.id === currentUserId}
                onChange={(e) =>
                  call('/api/users/role', { userId: user.id, role: e.target.value as UserRole }, user.id)
                }
                className="min-h-11 rounded-lg border border-line bg-white px-2 text-sm disabled:opacity-60"
              >
                <option value="user">משתמש</option>
                <option value="admin">מנהל מערכת</option>
              </select>

              <button
                type="button"
                disabled={busyId === user.id || user.id === currentUserId}
                onClick={() =>
                  call('/api/users/disable', { userId: user.id, disabled: !user.disabled }, user.id)
                }
                className={`min-h-11 rounded-lg border border-line bg-white px-3 text-sm disabled:opacity-40 ${
                  user.disabled ? 'text-fg' : 'text-danger'
                }`}
              >
                {user.disabled ? 'הפעלה' : 'השבתה'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  name,
  label,
  type,
  dir,
}: {
  name: string
  label: string
  type: string
  dir?: 'ltr'
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-medium text-fg">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        dir={dir}
        required
        className="min-h-11 rounded-lg border border-line bg-white px-3 text-start text-sm"
      />
    </div>
  )
}

const TONES = {
  success: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
} as const

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>{children}</span>
  )
}
