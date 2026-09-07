'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * "תצוגה מקדימה לשיתוף": the card a link to the campaign shows in
 * WhatsApp or a feed — title, one line, a picture. Three fields and a live
 * card; the tags behind them are the server's business.
 */

type Settings = { title: string; description: string; imageUrl: string | null; imageSource: 'upload' | 'default' | 'none' }

const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function ShareSettings({ projectId, campaignName, publicUrl }: { projectId: string; campaignName: string; publicUrl: string | null }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'upload' | 'remove'>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/share`)
      if (!r.ok) throw new Error()
      const data = (await r.json()) as { settings: Settings }
      setSettings(data.settings)
      setTitle(data.settings.title)
      setDescription(data.settings.description)
    } catch {
      setSettings(null)
      setMsg({ tone: 'error', text: 'טעינת הגדרות השיתוף נכשלה.' })
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<Response>, ok: string) => {
    setBusy(what)
    setMsg(null)
    try {
      const r = await fn()
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setMsg({ tone: 'error', text: data?.error?.message ?? 'הפעולה נכשלה.' })
        return
      }
      setSettings(data.settings)
      setMsg({ tone: 'ok', text: ok })
    } catch {
      setMsg({ tone: 'error', text: 'הפעולה נכשלה. נסו שוב.' })
    } finally {
      setBusy(null)
    }
  }

  if (!publicUrl) return null
  const host = (() => {
    try {
      return new URL(publicUrl).host
    } catch {
      return ''
    }
  })()

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">תצוגה מקדימה לשיתוף</h2>
      <p className="mt-1 text-sm text-muted">כך ייראה הקישור לעמוד הקמפיין כששולחים אותו בוואטסאפ, ב-SMS או ברשתות.</p>
      {settings === null ? (
        <p className="mt-3 text-sm text-muted" aria-busy="true">טוען…</p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-3">
            <label className="block text-sm">
              <span className="text-muted">כותרת לשיתוף</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} placeholder={campaignName} className={input} />
            </label>
            <label className="block text-sm">
              <span className="text-muted">תיאור לשיתוף</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={3} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
              <span className="mt-1 block text-xs text-muted">{description.length}/200</span>
            </label>
            <div>
              <p className="text-sm text-muted">תמונה לשיתוף</p>
              <p className="text-xs text-muted">מומלץ 1200×630, עד 2MB. {settings.imageSource === 'default' ? 'כרגע: התמונה המובנית של הקמפיין.' : settings.imageSource === 'upload' ? 'כרגע: תמונה שהועלתה.' : 'כרגע: ללא תמונה.'}</p>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="בחירת תמונה לשיתוף" onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const form = new FormData()
                form.append('file', file)
                void run('upload', () => fetch(`/api/projects/${projectId}/share/image`, { method: 'POST', body: form }), 'התמונה הועלתה.')
                e.target.value = ''
              }} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy !== null} onClick={() => fileRef.current?.click()} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand disabled:opacity-50">{busy === 'upload' ? 'מעלה…' : settings.imageSource === 'upload' ? 'החלפת תמונה' : 'העלאת תמונה'}</button>
                {settings.imageSource === 'upload' ? (
                  <button type="button" disabled={busy !== null} onClick={() => void run('remove', () => fetch(`/api/projects/${projectId}/share/image`, { method: 'DELETE' }), 'התמונה הוסרה.')} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm text-fg hover:border-red-400 disabled:opacity-50">הסרה</button>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy !== null} onClick={() => void run('save', () => fetch(`/api/projects/${projectId}/share`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) }), 'הגדרות השיתוף נשמרו.')} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === 'save' ? 'שומר…' : 'שמירה'}</button>
              {msg ? <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p> : null}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">כך זה ייראה</p>
            <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm" dir="rtl">
              {settings.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.imageUrl} alt="" className="aspect-[1200/630] w-full object-cover" />
              ) : (
                <div className="flex aspect-[1200/630] w-full items-center justify-center bg-slate-100 text-xs text-muted">ללא תמונה</div>
              )}
              <div className="p-3">
                <p className="truncate text-sm font-semibold text-fg">{title || campaignName}</p>
                <p className="line-clamp-2 text-xs text-muted">{description}</p>
                <p className="mt-1 text-[11px] uppercase text-muted" dir="ltr">{host}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
