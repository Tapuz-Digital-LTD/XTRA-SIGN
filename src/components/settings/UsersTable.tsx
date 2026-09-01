'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toIsraeliNationalFormat } from '@/lib/phone'
import type { UserRow, UserRole } from '@/server/users/users'

/**
 * The user list.
 *
 * An account is usable the moment it exists — there is no password to set and
 * nothing to accept — so a person is either active or disabled, with no third
 * "pending" state in between.
 */
export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function call(path: string, body: unknown, id: string) {
    setBusyId(id)
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
          onClick={() => {
            setCreating((v) => !v)
            setEditingId(null)
          }}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">
            +
          </span>
          הוספת משתמש
        </button>
      </div>

      {creating ? (
        <UserForm
          title="משתמש חדש"
          hint="המשתמש ייכנס עם מספר הטלפון שתזינו כאן ויקבל קוד חד-פעמי ב-SMS."
          submitLabel="יצירת משתמש"
          busy={busyId === 'new'}
          showRole
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const ok = await call('/api/users/create', values, 'new')
            if (ok) {
              setCreating(false)
              setNotice('המשתמש נוצר ויכול להיכנס עם מספר הטלפון שהוגדר.')
            }
          }}
        />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm text-danger"
        >
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
          <li key={user.id} className="px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
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
                <p className="truncate text-xs text-muted" dir="ltr">
                  {/* Stored as +972…, shown the way people read it. */}
                  {toIsraeliNationalFormat(user.phone) ?? user.phone}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Status carried by a word, never by colour alone. */}
                {user.disabled ? (
                  <Badge tone="danger">מושבת</Badge>
                ) : (
                  <Badge tone="success">פעיל</Badge>
                )}

                <select
                  aria-label={`הרשאה של ${user.name}`}
                  value={user.role}
                  disabled={busyId === user.id || user.id === currentUserId}
                  onChange={(e) =>
                    call(
                      '/api/users/role',
                      { userId: user.id, role: e.target.value as UserRole },
                      user.id,
                    )
                  }
                  className="min-h-11 rounded-lg border border-line bg-white px-2 text-sm disabled:opacity-60"
                >
                  <option value="user">משתמש</option>
                  <option value="admin">מנהל מערכת</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setEditingId((id) => (id === user.id ? null : user.id))
                    setCreating(false)
                  }}
                  className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-fg"
                >
                  {editingId === user.id ? 'סגירה' : 'עריכה'}
                </button>

                <button
                  type="button"
                  disabled={busyId === user.id || user.id === currentUserId}
                  onClick={() =>
                    call(
                      '/api/users/disable',
                      { userId: user.id, disabled: !user.disabled },
                      user.id,
                    )
                  }
                  className={`min-h-11 rounded-lg border border-line bg-white px-3 text-sm disabled:opacity-40 ${
                    user.disabled ? 'text-fg' : 'text-danger'
                  }`}
                >
                  {user.disabled ? 'הפעלה' : 'השבתה'}
                </button>
              </div>
            </div>

            {editingId === user.id ? (
              <div className="mt-3">
                <UserForm
                  title={`עריכת ${user.name}`}
                  hint="שינוי מספר הטלפון משנה את הדרך שבה המשתמש נכנס למערכת."
                  submitLabel="שמירה"
                  busy={busyId === user.id}
                  defaults={{ ...user, phone: toIsraeliNationalFormat(user.phone) ?? user.phone }}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    const ok = await call('/api/users/update', { userId: user.id, ...values }, user.id)
                    if (ok) {
                      setEditingId(null)
                      setNotice('הפרטים עודכנו.')
                    }
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

type FormValues = { name: string; email: string; phone: string; role?: UserRole }

function UserForm({
  title,
  hint,
  submitLabel,
  busy,
  showRole,
  defaults,
  onSubmit,
  onCancel,
}: {
  title: string
  hint: string
  submitLabel: string
  busy: boolean
  showRole?: boolean
  defaults?: Pick<UserRow, 'name' | 'email' | 'phone'>
  onSubmit: (values: FormValues) => void | Promise<void>
  onCancel: () => void
}) {
  return (
    <form
      className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        void onSubmit({
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          phone: String(form.get('phone') ?? ''),
          ...(showRole ? { role: (form.get('role') as UserRole) ?? 'user' } : {}),
        })
      }}
    >
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-1 text-xs text-muted">{hint}</p>

      {/* Whole class names, not interpolated fragments: Tailwind reads the
          source at build time and never sees a class it has to compute. */}
      <div className={`mt-4 grid gap-3 ${showRole ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <Field name="name" label="שם מלא" type="text" defaultValue={defaults?.name} />
        <Field
          name="email"
          label="אימייל"
          type="email"
          dir="ltr"
          defaultValue={defaults?.email}
        />
        <Field
          name="phone"
          label="טלפון נייד"
          type="tel"
          dir="ltr"
          defaultValue={defaults?.phone}
        />
        {showRole ? (
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
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-brand px-5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'שומר…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-line bg-white px-5 text-sm text-fg"
        >
          ביטול
        </button>
      </div>
    </form>
  )
}

function Field({
  name,
  label,
  type,
  dir,
  defaultValue,
}: {
  name: string
  label: string
  type: string
  dir?: 'ltr'
  defaultValue?: string
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
        defaultValue={defaultValue}
        className="min-h-11 rounded-lg border border-line bg-white px-3 text-start text-sm"
      />
    </div>
  )
}

const TONES = {
  success: 'bg-green-100 text-green-800',
  danger: 'bg-red-100 text-red-800',
} as const

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>{children}</span>
  )
}
