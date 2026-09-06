'use client'

import { useState } from 'react'
import type { MailTemplateKey } from '@/server/mail/catalog'

/**
 * Every email the system sends, as it will arrive: pick a template, see
 * it at desktop or phone width, send it to yourself. Sample data only —
 * nothing here touches a real document or a statistic.
 */
export function EmailPreview({ templates }: { templates: { key: MailTemplateKey; label: string; audience: 'signer' | 'team' }[] }) {
  const [current, setCurrent] = useState<MailTemplateKey>(templates[0].key)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function sendTest() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: current, to }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השליחה נכשלה.' })
        return
      }
      setMessage({ tone: 'ok', text: `מייל בדיקה נשלח אל ${to}.` })
    } catch {
      setMessage({ tone: 'error', text: 'השליחה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition ${active ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg hover:border-brand'}`

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
        {(['signer', 'team'] as const).map((audience) => (
          <div key={audience} className="mb-3">
            <p className="px-2 pb-1 text-xs font-semibold text-muted">{audience === 'signer' ? 'לחותם' : 'לצוות'}</p>
            <ul>
              {templates
                .filter((t) => t.audience === audience)
                .map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => setCurrent(t.key)}
                      aria-current={t.key === current ? 'true' : undefined}
                      className={`flex min-h-10 w-full items-center rounded-lg px-2 text-start text-sm transition ${t.key === current ? 'bg-brand/10 font-semibold text-fg' : 'text-fg hover:bg-bg'}`}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </aside>

      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setDevice('desktop')} className={chip(device === 'desktop')} aria-pressed={device === 'desktop'}>
              דסקטופ
            </button>
            <button type="button" onClick={() => setDevice('mobile')} className={chip(device === 'mobile')} aria-pressed={device === 'mobile'}>
              מובייל
            </button>
          </div>
          <a href={`/api/mail/preview?template=${current}&format=text`} target="_blank" rel="noreferrer" className="text-xs text-muted hover:underline">
            גרסת טקסט
          </a>
        </div>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-line bg-slate-100 p-3">
          <iframe
            key={`${current}-${device}`}
            title="תצוגה מקדימה של המייל"
            src={`/api/mail/preview?template=${current}`}
            sandbox=""
            style={{ width: device === 'mobile' ? 375 : '100%', maxWidth: '100%', height: 760, border: 0, background: '#f3f4f6', display: 'block', margin: '0 auto', borderRadius: 12 }}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            type="email"
            dir="ltr"
            placeholder="name@company.co.il"
            aria-label="כתובת לשליחת מייל בדיקה"
            className="h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy || !to}
            onClick={() => void sendTest()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'שולח…' : 'שלח מייל בדיקה'}
          </button>
        </div>
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>
            {message.text}
          </p>
        ) : null}
      </section>
    </div>
  )
}
