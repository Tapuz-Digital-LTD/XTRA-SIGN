'use client'

import { useEffect, useState } from 'react'
import {
  CHANNEL_LABELS,
  CONTENT_KINDS,
  DEFAULT_DISTRIBUTION_MESSAGE,
  DISTRIBUTION_STEPS,
  MIN_HOURS_BETWEEN_SENDS,
  STEP_LABELS,
  type DistributionChannel,
  type DistributionContentKind,
  type DistributionDraft,
} from '@/lib/distributions'
import { VARIABLE_CATALOG } from '@/lib/message-template'
import { smsLength } from '@/lib/sms-length'

/**
 * "הפצה חדשה" in five steps: who, on which channels, what, when, and a last
 * look with a test send before the real one. Saving makes a draft; sending
 * is a second, explicit click that reports what happened.
 */

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm?: boolean; contactPhone?: string | null; contactEmail?: string | null }

const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const textarea = 'mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand'
const chip = (on: boolean) => `inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium ${on ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg'}`

const DISTRIBUTION_VARIABLES = VARIABLE_CATALOG.filter((v) => ['signer_name', 'first_name', 'company_name', 'campaign_name', 'campaign_url', 'campaign_start', 'campaign_end', 'distribution_name'].includes(v.key))

export function DistributionWizard({
  projectId,
  publicUrl,
  isAdmin,
  onClose,
  onDone,
}: {
  projectId: string
  /** The campaign's public address, or null when it has none (a signature campaign). */
  publicUrl: string | null
  isAdmin: boolean
  onClose: () => void
  onDone: (result: { id: string; sent: boolean }) => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [audienceKind, setAudienceKind] = useState<'supplier' | 'customer'>('supplier')
  const [source, setSource] = useState<'all' | 'crm' | 'xtra'>('all')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<Map<string, Company>>(new Map())
  const [channels, setChannels] = useState<DistributionChannel[]>(['sms'])
  const [contentKind, setContentKind] = useState<DistributionContentKind>(publicUrl ? 'campaign_link' : 'url')
  const [contentUrl, setContentUrl] = useState('')
  const [sms, setSms] = useState(DEFAULT_DISTRIBUTION_MESSAGE.sms)
  const [email, setEmail] = useState({ ...DEFAULT_DISTRIBUTION_MESSAGE.email })
  const [when, setWhen] = useState<'now' | 'draft'>('now')
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'send' | 'test'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [override, setOverride] = useState(false)

  useEffect(() => {
    if (step !== 0) return
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      fetch(`/api/companies?kind=${audienceKind}&q=${encodeURIComponent(query)}&limit=50${source === 'all' ? '' : `&source=${source}`}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { companies: [] }))
        .then((data: { companies?: Company[] }) => setResults(data?.companies ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [step, audienceKind, source, query])

  const chosenList = [...chosen.values()]
  const withPhone = chosenList.filter((c) => c.contactPhone).length
  const withEmail = chosenList.filter((c) => c.contactEmail).length
  const reachable = chosenList.filter((c) => (channels.includes('sms') && c.contactPhone) || (channels.includes('email') && c.contactEmail)).length
  const smsInfo = smsLength(sms.replace(/\{\{campaign_url\}\}/g, 'https://xtra.sign/abcdefgh'))
  const targetUrl = contentKind === 'url' ? contentUrl : (publicUrl ?? '')

  const stepOk = [
    chosen.size > 0,
    channels.length > 0 && reachable > 0,
    (contentKind === 'campaign_link' ? Boolean(publicUrl) : /^https?:\/\/\S+$/i.test(contentUrl)) &&
      (!channels.includes('sms') || sms.includes('{{campaign_url}}')) &&
      (!channels.includes('email') || (email.subject.trim() && email.body.trim())),
    name.trim().length > 0,
    true,
  ]

  function toggle(c: Company) {
    setChosen((prev) => {
      const next = new Map(prev)
      if (next.has(c.id)) next.delete(c.id)
      else next.set(c.id, c)
      return next
    })
  }
  function chooseAllShown() {
    setChosen((prev) => {
      const next = new Map(prev)
      for (const c of results) next.set(c.id, c)
      return next
    })
  }
  function insertVar(key: string, target: 'sms' | 'body') {
    const token = `{{${key}}}`
    if (target === 'sms') setSms((s) => (s.endsWith(' ') || s.length === 0 ? `${s}${token}` : `${s} ${token}`))
    else setEmail((e) => ({ ...e, body: e.body.endsWith(' ') || e.body.length === 0 ? `${e.body}${token}` : `${e.body} ${token}` }))
  }

  function draft(): DistributionDraft {
    return {
      name: name.trim(),
      channels,
      contentKind,
      contentUrl,
      message: { sms, email },
      audience: { kind: audienceKind, source, companyIds: [...chosen.keys()] },
      scheduledAt: null,
    }
  }

  async function fail(response: Response, fallback: string) {
    const data = await response.json().catch(() => null)
    setError(data?.error?.message ?? fallback)
  }

  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId
    const response = await fetch(`/api/projects/${projectId}/distributions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft()) })
    if (!response.ok) {
      await fail(response, 'השמירה נכשלה.')
      return null
    }
    const data = (await response.json()) as { id: string }
    setDraftId(data.id)
    return data.id
  }

  async function sendTest() {
    if (!testPhone.trim() && !testEmail.trim()) {
      setError('הזינו טלפון או אימייל לבדיקה — הפרטים שלכם, לא של נמען.')
      return
    }
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const id = await ensureDraft()
      if (!id) return
      const response = await fetch(`/api/projects/${projectId}/distributions/${id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: testPhone, email: testEmail }) })
      if (!response.ok) return void (await fail(response, 'שליחת הבדיקה נכשלה.'))
      setNotice('הודעת הבדיקה נשלחה. בדקו את הטלפון/האימייל שלכם.')
    } catch {
      setError('שליחת הבדיקה נכשלה. נסו שוב.')
    } finally {
      setBusy(null)
    }
  }

  async function finish() {
    setBusy(when === 'now' ? 'send' : 'save')
    setError(null)
    setNotice(null)
    try {
      const id = await ensureDraft()
      if (!id) return
      if (when === 'draft') return onDone({ id, sent: false })
      const response = await fetch(`/api/projects/${projectId}/distributions/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ override }) })
      if (!response.ok) return void (await fail(response, 'השליחה נכשלה.'))
      onDone({ id, sent: true })
    } catch {
      setError('השליחה נכשלה. נסו שוב.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dw-title" onClick={(e) => e.stopPropagation()} className="flex max-h-[94dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="border-b border-line px-5 py-4">
          <h2 id="dw-title" className="text-base font-semibold text-fg">הפצה חדשה</h2>
          <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="שלבים">
            {DISTRIBUTION_STEPS.map((key, i) => (
              <li key={key} className={i === step ? 'font-semibold text-brand' : i < step ? 'text-fg' : 'text-muted'} aria-current={i === step ? 'step' : undefined}>
                {i + 1}. {STEP_LABELS[key]}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 ? (
            <fieldset>
              <legend className="text-sm font-medium text-fg">מאיפה לבחור נמענים?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['supplier', 'customer'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => { setAudienceKind(k); setChosen(new Map()) }} aria-pressed={audienceKind === k} className={chip(audienceKind === k)}>
                    {k === 'supplier' ? 'ספקים' : 'לקוחות'}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">מקור:</span>
                {(['all', 'crm', 'xtra'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSource(s)} aria-pressed={source === s} className={`inline-flex min-h-8 items-center rounded-full border px-3 font-medium ${source === s ? 'border-fg bg-fg text-white' : 'border-line bg-surface text-fg'}`}>
                    {s === 'all' ? 'הכול' : s === 'crm' ? 'CRM' : 'XTRA Sign'}
                  </button>
                ))}
                <span className="text-muted">רשומות CRM מסונכרנות מקומית; הבחירה לא משנה דבר ב-Fireberry.</span>
              </div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי שם, ח.פ., טלפון או אימייל" className={input} aria-label="חיפוש" />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>{searching ? 'מחפש…' : `${results.length} תוצאות`}</span>
                <button type="button" onClick={chooseAllShown} disabled={results.length === 0} className="font-medium text-brand disabled:opacity-50">בחר את כל התוצאות</button>
              </div>
              <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {results.map((c) => (
                  <li key={c.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c)} className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.fromCrm ? <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">CRM</span> : null}
                      <span className="text-xs text-muted" dir="ltr">{c.contactPhone ?? c.contactEmail ?? '—'}</span>
                    </label>
                  </li>
                ))}
                {!searching && results.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">לא נמצאו רשומות.</li> : null}
              </ul>
              <p className="mt-2 text-sm text-fg">
                נבחרו <strong>{chosen.size}</strong> · עם טלפון {withPhone} · עם אימייל {withEmail}
              </p>
            </fieldset>
          ) : null}

          {step === 1 ? (
            <fieldset>
              <legend className="text-sm font-medium text-fg">באילו ערוצים לשלוח?</legend>
              <div className="mt-2 flex flex-col gap-2">
                {(['sms', 'email'] as const).map((ch) => (
                  <label key={ch} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
                    <input type="checkbox" checked={channels.includes(ch)} onChange={(e) => setChannels((prev) => (e.target.checked ? [...prev, ch] : prev.filter((x) => x !== ch)))} className="h-4 w-4" />
                    <span className="flex-1">{CHANNEL_LABELS[ch]}</span>
                    <span className="text-xs text-muted">{ch === 'sms' ? `${withPhone} עם טלפון` : `${withEmail} עם אימייל`}</span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-sm text-fg">
                יגיעו ל-<strong>{reachable}</strong> מתוך {chosen.size} נמענים.{reachable < chosen.size ? ' השאר יסומנו כ"דולגו" — חסר להם פרט קשר לערוץ שנבחר.' : ''}
              </p>
            </fieldset>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <fieldset>
                <legend className="text-sm font-medium text-fg">מה שולחים?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {CONTENT_KINDS.map((k) => {
                    const disabled = k.key === 'campaign_link' && !publicUrl
                    return (
                      <button key={k.key} type="button" disabled={disabled} onClick={() => setContentKind(k.key)} aria-pressed={contentKind === k.key} className={`rounded-xl border p-3 text-start ${contentKind === k.key ? 'border-brand bg-blue-50' : 'border-line bg-bg'} disabled:opacity-50`}>
                        <span className="block text-sm font-semibold text-fg">{k.label}</span>
                        <span className="mt-1 block text-xs text-muted">{disabled ? 'לקמפיין הזה אין עמוד ציבורי.' : k.blurb}</span>
                      </button>
                    )
                  })}
                </div>
                {contentKind === 'campaign_link' && publicUrl ? <p className="mt-2 text-xs text-muted" dir="ltr">{publicUrl}</p> : null}
                {contentKind === 'url' ? (
                  <label className="mt-2 block text-sm">
                    <span className="text-muted">כתובת</span>
                    <input value={contentUrl} onChange={(e) => setContentUrl(e.target.value)} placeholder="https://…" dir="ltr" className={input} />
                  </label>
                ) : null}
              </fieldset>
              {channels.includes('sms') ? (
                <div>
                  <label className="block text-sm">
                    <span className="text-muted">הודעת SMS</span>
                    <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} className={textarea} />
                  </label>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>{smsInfo.chars} תווים · {smsInfo.segments} {smsInfo.segments === 1 ? 'הודעה' : 'הודעות'} (הערכה, {smsInfo.encoding === 'ucs2' ? 'עברית' : 'לטינית'})</span>
                    {!sms.includes('{{campaign_url}}') ? <span className="text-red-700">חסר {'{{campaign_url}}'}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {DISTRIBUTION_VARIABLES.map((v) => (
                      <button key={v.key} type="button" onClick={() => insertVar(v.key, 'sms')} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg hover:border-brand">{v.label}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {channels.includes('email') ? (
                <div className="flex flex-col gap-2">
                  <label className="block text-sm">
                    <span className="text-muted">נושא האימייל</span>
                    <input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className={input} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">גוף האימייל</span>
                    <textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} rows={4} className={textarea} />
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {DISTRIBUTION_VARIABLES.map((v) => (
                      <button key={v.key} type="button" onClick={() => insertVar(v.key, 'body')} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg hover:border-brand">{v.label}</button>
                    ))}
                  </div>
                  <label className="block text-sm">
                    <span className="text-muted">טקסט הכפתור</span>
                    <input value={email.cta} onChange={(e) => setEmail({ ...email, cta: e.target.value })} className={input} />
                  </label>
                  <p className="text-xs text-muted">הכפתור מוביל אל: <span dir="ltr">{targetUrl || '—'}</span></p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-4">
              <label className="block text-sm">
                <span className="text-muted">שם ההפצה <span className="text-red-700">*</span></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: הזמנה ראשונה לספקים" className={input} />
              </label>
              <fieldset>
                <legend className="text-sm font-medium text-fg">מתי?</legend>
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
                    <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
                    <span>לשלוח עכשיו, מיד אחרי הבדיקה</span>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
                    <input type="radio" name="when" checked={when === 'draft'} onChange={() => setWhen('draft')} />
                    <span>לשמור כטיוטה ולשלוח מאוחר יותר מרשימת ההפצות</span>
                  </label>
                </div>
              </fieldset>
              <p className="text-xs text-muted">נמען שקיבל מאיתנו הודעה ב-{MIN_HOURS_BETWEEN_SENDS} השעות האחרונות ידולג, אלא אם מנהל יאשר אחרת בשלב הבא.</p>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-bg p-3 text-sm">
                <dt className="text-muted">שם</dt><dd className="text-fg">{name}</dd>
                <dt className="text-muted">קהל</dt><dd className="text-fg">{chosen.size} {audienceKind === 'supplier' ? 'ספקים' : 'לקוחות'} · יגיעו ל-{reachable}</dd>
                <dt className="text-muted">ערוצים</dt><dd className="text-fg">{channels.map((c) => CHANNEL_LABELS[c]).join(' + ')}</dd>
                <dt className="text-muted">תוכן</dt><dd className="text-fg" dir="ltr">{targetUrl}</dd>
                <dt className="text-muted">מתי</dt><dd className="text-fg">{when === 'now' ? 'עכשיו' : 'טיוטה'}</dd>
              </dl>
              {channels.includes('sms') ? <div className="rounded-lg border border-line p-3 text-sm"><p className="text-xs text-muted">SMS</p><p className="mt-1 whitespace-pre-wrap text-fg">{sms}</p></div> : null}
              {channels.includes('email') ? <div className="rounded-lg border border-line p-3 text-sm"><p className="text-xs text-muted">אימייל · {email.subject}</p><p className="mt-1 whitespace-pre-wrap text-fg">{email.body}</p><p className="mt-2 inline-block rounded bg-brand px-3 py-1 text-xs text-white">{email.cta}</p></div> : null}
              <fieldset className="rounded-lg border border-dashed border-line p-3">
                <legend className="px-1 text-sm font-medium text-fg">שליחת בדיקה אליכם</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {channels.includes('sms') ? <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="הטלפון שלכם" dir="ltr" className={input} aria-label="טלפון לבדיקה" /> : null}
                  {channels.includes('email') ? <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="האימייל שלכם" dir="ltr" className={input} aria-label="אימייל לבדיקה" /> : null}
                </div>
                <button type="button" onClick={sendTest} disabled={busy !== null} className={`${secondary} mt-2`}>{busy === 'test' ? 'שולח בדיקה…' : 'שלח בדיקה'}</button>
                <p className="mt-1 text-xs text-muted">הבדיקה נשלחת רק לפרטים שהזנתם כאן ומסומנת כבדיקה. הקהל לא מקבל דבר.</p>
              </fieldset>
              {isAdmin ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-4 w-4" />
                  לשלוח גם למי שקיבל הודעה ב-{MIN_HOURS_BETWEEN_SENDS} השעות האחרונות (נרשם ביומן הביקורת)
                </label>
              ) : null}
            </div>
          ) : null}

          {notice ? <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p> : null}
          {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={step === 0 ? onClose : () => setStep(step - 1)} disabled={busy !== null} className={secondary}>{step === 0 ? 'ביטול' : 'חזרה'}</button>
          {step < DISTRIBUTION_STEPS.length - 1 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!stepOk[step]} className={primary}>המשך</button>
          ) : (
            <button type="button" onClick={finish} disabled={busy !== null} className={primary}>
              {busy === 'send' ? 'שולח…' : busy === 'save' ? 'שומר…' : when === 'now' ? `שלח ל-${reachable} נמענים` : 'שמור כטיוטה'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
