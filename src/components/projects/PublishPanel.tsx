'use client'

import { useState } from 'react'
import type { FormField } from '@/server/projects/form-schema'
import { TYPE_LABELS } from '@/components/projects/FormBuilder'

/**
 * The three ways out of the same form: the hosted link, the embed snippet,
 * and the public submission API — documented well enough that a developer on
 * another site can wire a lead in minutes, without a single secret on screen.
 * The form id is publishable by design: it can do exactly one thing, create a
 * lead on this form.
 */

function sampleValue(field: FormField): unknown {
  switch (field.type) {
    case 'email': return 'name@example.com'
    case 'phone': return '0501234567'
    case 'number': return '3'
    case 'date': return '2026-01-30'
    case 'select': return field.options?.[0] ?? ''
    case 'multiselect': return field.options?.slice(0, 2) ?? []
    case 'checkbox': return true
    default: return field.id === 'name' ? 'שם החברה בע״מ' : 'טקסט'
  }
}

function CopyButton({ text, label = 'העתקה' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
    >
      {copied ? 'הועתק ✓' : label}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre dir="ltr" className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
      <code>{code}</code>
    </pre>
  )
}

export function PublishPanel({
  slug,
  url,
  fields,
  allowedOrigins,
  onOriginsChange,
}: {
  slug: string
  url: string
  fields: FormField[]
  allowedOrigins: string
  onOriginsChange: (value: string) => void
}) {
  const [open, setOpen] = useState<'embed' | 'api' | null>(null)
  const origin = url.replace(/\/join\/.*$/, '')
  const endpoint = `${origin}/api/public/forms/${slug}/submissions`
  const visible = fields.filter((f) => !f.hidden)

  const embedSnippet = `<div data-xtra-form="${slug}"></div>\n<script src="${origin}/embed.js" async></script>`

  const exampleValues = Object.fromEntries(visible.map((f) => [f.id, sampleValue(f)]))
  const exampleJson = JSON.stringify({ values: exampleValues }, null, 2)
  const exampleJs = `fetch("${endpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${exampleJson.replace(/\n/g, '\n  ')}),
})
  .then(async (r) => {
    if (!r.ok) throw await r.json(); // { error: { message, fields } }
    // { ok: true }
  })`

  return (
    <div className="flex flex-col gap-3">
      {/* Embed */}
      <div className="rounded-lg border border-line bg-bg">
        <button
          type="button"
          onClick={() => setOpen(open === 'embed' ? null : 'embed')}
          aria-expanded={open === 'embed'}
          className="flex min-h-12 w-full items-center justify-between px-4 text-sm font-medium text-fg"
        >
          הטמעה באתר שלכם
          <span aria-hidden="true" className="text-muted">{open === 'embed' ? '−' : '+'}</span>
        </button>
        {open === 'embed' ? (
          <div className="border-t border-line px-4 py-3">
            <p className="text-sm text-muted">
              מדביקים את שתי השורות האלה בכל עמוד — הטופס יופיע שם, יתאים את גובהו לבד, ויעבוד גם בטלפון.
            </p>
            <CodeBlock code={embedSnippet} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">
                אפשר להאזין לאירוע <code dir="ltr">xtra-form:submitted</code> אחרי שליחה מוצלחת.
              </span>
              <CopyButton text={embedSnippet} label="העתק קוד הטמעה" />
            </div>
          </div>
        ) : null}
      </div>

      {/* API */}
      <div className="rounded-lg border border-line bg-bg">
        <button
          type="button"
          onClick={() => setOpen(open === 'api' ? null : 'api')}
          aria-expanded={open === 'api'}
          className="flex min-h-12 w-full items-center justify-between px-4 text-sm font-medium text-fg"
        >
          חיבור מותאם אישית (API)
          <span aria-hidden="true" className="text-muted">{open === 'api' ? '−' : '+'}</span>
        </button>
        {open === 'api' ? (
          <div className="border-t border-line px-4 py-3">
            <p className="text-sm text-muted">
              לבניית עמוד נחיתה משלכם: שולחים JSON לכתובת הזו וכל שליחה הופכת לליד בפרויקט.
              מזהה הטופס ציבורי ומאפשר רק יצירת ליד — הוא לא חושף ולא משנה שום נתון.
            </p>

            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted">Endpoint</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <code dir="ltr" className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs">POST {endpoint}</code>
                  <CopyButton text={endpoint} />
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted">מזהה הטופס</dt>
                <dd className="flex items-center gap-2">
                  <code dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{slug}</code>
                  <CopyButton text={slug} />
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs font-medium text-muted">השדות</p>
            <div className="mt-1 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[28rem] text-start text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="px-3 py-2 text-start font-medium">מזהה (id)</th>
                    <th className="px-3 py-2 text-start font-medium">שדה</th>
                    <th className="px-3 py-2 text-start font-medium">סוג</th>
                    <th className="px-3 py-2 text-start font-medium">חובה</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((field) => (
                    <tr key={field.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2" dir="ltr"><code>{field.id}</code></td>
                      <td className="px-3 py-2">{field.label}</td>
                      <td className="px-3 py-2 text-muted">{TYPE_LABELS[field.type]}</td>
                      <td className="px-3 py-2">{field.required ? 'כן' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted">גוף הבקשה — דוגמה</p>
              <CopyButton text={exampleJson} />
            </div>
            <CodeBlock code={exampleJson} />

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted">JavaScript — דוגמה</p>
              <CopyButton text={exampleJs} />
            </div>
            <CodeBlock code={exampleJs} />

            <p className="mt-3 text-xs text-muted">
              אפשר לצרף כותרת <code dir="ltr">Idempotency-Key</code> כדי ששליחה חוזרת של אותה בקשה לא תיצור ליד כפול.
              תשובת הצלחה: <code dir="ltr">201 {'{ "ok": true }'}</code>; שגיאת ולידציה: <code dir="ltr">422</code> עם פירוט לפי שדה.
            </p>

            <label className="mt-4 block text-sm">
              <span className="font-medium text-fg">הגבלת דומיינים (רשות)</span>
              <span className="mt-0.5 block text-xs text-muted">
                אם ממלאים — רק העמודים בדומיינים האלה יוכלו לשלוח מהדפדפן. שורה לכל דומיין, למשל: https://example.co.il
              </span>
              <textarea
                value={allowedOrigins}
                onChange={(e) => onOriginsChange(e.target.value)}
                rows={2}
                dir="ltr"
                placeholder="https://example.co.il"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand"
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  )
}
