'use client'

import { useCallback, useEffect, useState } from 'react'
import { GROUP_LABELS, type MessageEvent, type MessageTemplate, type VariableCatalogEntry } from '@/lib/message-template'
import { smsLength } from '@/lib/sms-length'
import { DeviceToggle, MailFrame, type MailDevice } from '@/components/mail/MailFrame'

/**
 * Campaign → הגדרות → הודעות. One card per event, closed by default and
 * marked "ברירת מחדל" or "מותאם לקמפיין". Inside: the SMS and the email,
 * a variable picker, a live preview, a test send to yourself, and a way
 * back to the default. The OTP text is shown, not edited.
 */

type EventRow = {
  event: MessageEvent
  label: string
  blurb: string
  channels: ('sms' | 'email')[]
  defaults: MessageTemplate
  override: Partial<MessageTemplate> | null
}
type Settings = { kind: 'public' | 'signature'; events: EventRow[]; variables: VariableCatalogEntry[]; otp: string }
type Preview = { sms?: { text: string; missing: string[] }; email?: { subject: string; html: string; text: string; missing: string[] } }

const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const textarea = 'mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand'
const primary = 'inline-flex min-h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'

export function MessagesSettings({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/messages`)
      if (!response.ok) throw new Error()
      setSettings((await response.json()) as Settings)
    } catch {
      setSettings(null)
      setError('טעינת ההודעות נכשלה.')
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">הודעות</h2>
      <p className="mt-1 text-sm text-muted">מה הקמפיין אומר בכל שלב. בלי שינוי, המערכת משתמשת בנוסח שלה.</p>
      {error ? (
        <p role="alert" className="mt-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => void load()} className="font-medium underline">נסו שוב</button>
        </p>
      ) : null}
      {settings === null && !error ? <p className="mt-3 text-sm text-muted" aria-busy="true">טוען…</p> : null}
      {settings ? (
        <div className="mt-4 flex flex-col gap-3">
          {settings.events.map((row) => (
            <EventCard key={row.event} projectId={projectId} row={row} variables={settings.variables} onSaved={load} />
          ))}
          <details className="rounded-lg border border-line bg-bg">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 text-sm font-medium text-fg">
              קוד אימות (OTP)
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">נשלט על ידי המערכת</span>
            </summary>
            <div className="border-t border-line px-4 py-3">
              <p className="text-xs text-muted">נוסח קבוע, בפורמט שמאפשר מילוי אוטומטי של הקוד בטלפון. אינו ניתן לעריכה.</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface p-3 text-sm text-fg" dir="rtl">{settings.otp}</pre>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  )
}

function EventCard({ projectId, row, variables, onSaved }: { projectId: string; row: EventRow; variables: VariableCatalogEntry[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const initial = {
    sms: row.override?.sms ?? row.defaults.sms ?? '',
    email: { subject: row.override?.email?.subject || row.defaults.email?.subject || '', body: row.override?.email?.body || row.defaults.email?.body || '', cta: row.override?.email?.cta || row.defaults.email?.cta || '' },
  }
  const [sms, setSms] = useState(initial.sms)
  const [email, setEmail] = useState(initial.email)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewMode, setPreviewMode] = useState<MailDevice>('desktop')
  const [busy, setBusy] = useState<null | 'save' | 'reset' | 'test' | 'preview'>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const customized = row.override !== null
  const hasSms = row.channels.includes('sms')
  const hasEmail = row.channels.includes('email')
  const smsInfo = smsLength(sms.replace(/\{\{[a-z_]+(\s*\|[^}]*)?\}\}/g, 'https://xtra.sign/abcdefgh'))
  const draft = () => ({ ...(hasSms ? { sms } : {}), ...(hasEmail ? { email } : {}) })

  const call = async (path: string, method: string, body: unknown) => {
    const response = await fetch(`/api/projects/${projectId}/messages${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error?.message ?? 'הפעולה נכשלה.')
    return data
  }
  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<string | void>) => {
    setBusy(what)
    setMsg(null)
    try {
      const text = await fn()
      if (text) setMsg({ kind: 'ok', text })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'הפעולה נכשלה.' })
    } finally {
      setBusy(null)
    }
  }

  const refreshPreview = () => run('preview', async () => { setPreview((await call('/preview', 'POST', { event: row.event, override: draft() })) as Preview) })

  useEffect(() => {
    if (!open || preview) return
    void refreshPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const insert = (key: string, target: 'sms' | 'body' | 'subject') => {
    const token = `{{${key}}}`
    if (target === 'sms') setSms((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}${token}`)
    else setEmail((e) => ({ ...e, [target]: `${e[target]}${e[target] && !e[target].endsWith(' ') ? ' ' : ''}${token}` }))
  }
  const groups = [...new Set(variables.map((v) => v.group))]

  return (
    <div className="rounded-lg border border-line bg-bg">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-start">
        <span>
          <span className="block text-sm font-medium text-fg">{row.label}</span>
          <span className="block text-xs text-muted">{row.blurb}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${customized ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{customized ? 'מותאם לקמפיין' : 'ברירת מחדל'}</span>
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-line px-4 py-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {hasSms ? (
              <div>
                <label className="block text-sm">
                  <span className="text-muted">SMS</span>
                  <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} className={textarea} dir="rtl" />
                </label>
                <p className="mt-1 text-xs text-muted">{smsInfo.chars} תווים · {smsInfo.segments} {smsInfo.segments === 1 ? 'הודעה' : 'הודעות'} (הערכה)</p>
                <VariablePicker groups={groups} variables={variables} onPick={(k) => insert(k, 'sms')} />
              </div>
            ) : null}
            {hasEmail ? (
              <div className="flex flex-col gap-2">
                <label className="block text-sm">
                  <span className="text-muted">נושא</span>
                  <input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className={input} dir="rtl" />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">גוף ההודעה</span>
                  <textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} rows={5} className={textarea} dir="rtl" />
                </label>
                <VariablePicker groups={groups} variables={variables} onPick={(k) => insert(k, 'body')} />
                <label className="block text-sm">
                  <span className="text-muted">טקסט הכפתור</span>
                  <input value={email.cta} onChange={(e) => setEmail({ ...email, cta: e.target.value })} className={input} dir="rtl" />
                </label>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy !== null} onClick={() => run('save', async () => { await call('', 'PUT', { event: row.event, override: draft() }); await onSaved(); return 'נשמר.' })}>{busy === 'save' ? 'שומר…' : 'שמור'}</button>
              <button type="button" className={secondary} disabled={busy !== null} onClick={refreshPreview}>{busy === 'preview' ? 'מרענן…' : 'רענן תצוגה מקדימה'}</button>
              <button type="button" className={secondary} disabled={busy !== null || !customized} onClick={() => run('reset', async () => { await call('', 'PUT', { event: row.event, override: null }); setSms(row.defaults.sms ?? ''); setEmail({ subject: row.defaults.email?.subject ?? '', body: row.defaults.email?.body ?? '', cta: row.defaults.email?.cta ?? '' }); setPreview(null); await onSaved(); return 'חזרנו לברירת המחדל.' })}>שחזר לברירת מחדל</button>
            </div>
            <fieldset className="rounded-lg border border-dashed border-line p-3">
              <legend className="px-1 text-xs font-medium text-fg">שליחת בדיקה אליכם</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {hasSms ? <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="הטלפון שלכם" dir="ltr" className={input} aria-label="טלפון לבדיקה" /> : null}
                {hasEmail ? <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="האימייל שלכם" dir="ltr" className={input} aria-label="אימייל לבדיקה" /> : null}
              </div>
              <button type="button" className={`${secondary} mt-2`} disabled={busy !== null} onClick={() => run('test', async () => { await call('/test', 'POST', { event: row.event, override: draft(), phone: testPhone, email: testEmail }); return 'הבדיקה נשלחה.' })}>{busy === 'test' ? 'שולח…' : 'שלח בדיקה'}</button>
              <p className="mt-1 text-xs text-muted">נשלח רק לפרטים שהזנתם כאן ומסומן כבדיקה.</p>
            </fieldset>
            {msg ? <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${msg.kind === 'err' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{msg.text}</p> : null}
          </div>
          <div className="min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">תצוגה מקדימה (ערכי דוגמה)</p>
              {hasEmail ? <DeviceToggle device={previewMode} onChange={setPreviewMode} /> : null}
            </div>
            {preview?.sms ? (
              <div className="mt-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <p className="text-xs text-muted">SMS</p>
                <p className="mt-1 whitespace-pre-wrap text-fg" dir="rtl">{preview.sms.text}</p>
                {preview.sms.missing.length ? <p className="mt-1 text-xs text-amber-700">משתנים ללא ערך: {preview.sms.missing.join(', ')}</p> : null}
              </div>
            ) : null}
            {preview?.email ? (
              <div className="mt-2">
                <p className="text-xs text-muted">אימייל · {preview.email.subject}</p>
                {preview.email.missing.length ? <p className="mt-1 text-xs text-amber-700">משתנים ללא ערך: {preview.email.missing.join(', ')}</p> : null}
                <div className="mt-1"><MailFrame html={preview.email.html} device={previewMode} title="תצוגה מקדימה" /></div>
              </div>
            ) : null}
            {!preview && busy === 'preview' ? <p className="mt-2 text-sm text-muted" aria-busy="true">מכין תצוגה מקדימה…</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function VariablePicker({ groups, variables, onPick }: { groups: string[]; variables: VariableCatalogEntry[]; onPick: (key: string) => void }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted">הוסף משתנה:</span>
      {groups.map((g) => (
        <span key={g} className="inline-flex flex-wrap items-center gap-1">
          <span className="text-muted">{GROUP_LABELS[g as keyof typeof GROUP_LABELS]}:</span>
          {variables.filter((v) => v.group === g).map((v) => (
            <button key={v.key} type="button" onClick={() => onPick(v.key)} className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg hover:border-brand" title={`{{${v.key}}}`}>{v.label}</button>
          ))}
        </span>
      ))}
    </div>
  )
}
