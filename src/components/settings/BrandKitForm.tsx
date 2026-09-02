'use client'

import { useState } from 'react'
import type { OrganizationProfile } from '@/server/organization/profile'

/**
 * The organization's own details, and the brand a designed document follows.
 *
 * One place for "our" side of every agreement, so a legal name is corrected
 * once rather than in each template — and so the assistant reads it instead of
 * being told it.
 */
export function BrandKitForm({ profile }: { profile: OrganizationProfile }) {
  const [form, setForm] = useState(profile)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof OrganizationProfile) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/organization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השמירה נכשלה.')
        return
      }
      setSaved(true)
    } catch {
      setError('השמירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  const field = (
    key: keyof OrganizationProfile,
    label: string,
    props: { type?: string; placeholder?: string; dir?: 'ltr' | 'rtl' } = {},
  ) => (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input
        value={(form[key] as string) ?? ''}
        onChange={(event) => set(key)(event.target.value)}
        type={props.type ?? 'text'}
        dir={props.dir}
        placeholder={props.placeholder}
        className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
      />
    </label>
  )

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-fg">פרטי הארגון</h2>
        <p className="mt-0.5 text-xs text-muted">
          הפרטים האלה מופיעים בראש כל מסמך שנוצר במערכת.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {field('name', 'שם הארגון')}
          {field('legalName', 'שם משפטי (לחוזים)')}
          {field('taxId', 'ח.פ / ע.מ', { dir: 'ltr' })}
          {field('address', 'כתובת')}
          {field('phone', 'טלפון', { dir: 'ltr' })}
          {field('email', 'אימייל', { type: 'email', dir: 'ltr' })}
          {field('website', 'אתר', { dir: 'ltr', placeholder: 'https://' })}
          {field('logoUrl', 'כתובת הלוגו', { dir: 'ltr', placeholder: 'https://' })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-fg">מיתוג</h2>
        <p className="mt-0.5 text-xs text-muted">
          כשמבקשים מ-XTRA AI לעצב מסמך, הוא משתמש בצבעים האלה.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">צבע ראשי</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                aria-label="צבע ראשי"
                value={form.brandPrimary ?? '#1e3a5f'}
                onChange={(event) => set('brandPrimary')(event.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1"
              />
              <input
                value={form.brandPrimary ?? ''}
                onChange={(event) => set('brandPrimary')(event.target.value)}
                dir="ltr"
                placeholder="#1e3a5f"
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
              />
            </div>
          </label>
          <label className="block text-sm">
            <span className="text-muted">צבע משני</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                aria-label="צבע משני"
                value={form.brandAccent ?? '#2563eb'}
                onChange={(event) => set('brandAccent')(event.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1"
              />
              <input
                value={form.brandAccent ?? ''}
                onChange={(event) => set('brandAccent')(event.target.value)}
                dir="ltr"
                placeholder="#2563eb"
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
              />
            </div>
          </label>
          {field('brandFont', 'גופן מועדף', { placeholder: 'Assistant' })}
          {field('footerText', 'שורת תחתית למסמכים')}
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        {saved ? <span className="text-sm text-green-800">✓ נשמר</span> : null}
      </div>
    </form>
  )
}
