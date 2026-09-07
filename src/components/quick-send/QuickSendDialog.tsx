'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * "שלח מסמך לחתימה": who → which document → how. Three short steps in one
 * dialog, nothing to set up first. An existing supplier or customer, or a
 * person the system does not know yet — no record is created for them.
 */
type Company = { id: string; name: string; kind: 'supplier' | 'customer'; fromCrm: boolean; contactPhone: string | null; contactEmail: string | null }
type Template = { id: string; name: string }
type Channel = 'sms' | 'email' | 'whatsapp'
type Step = 'who' | 'what' | 'how' | 'done'

const input = 'mt-1 w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg outline-none focus:border-brand'
const big = 'inline-flex min-h-14 items-center justify-center rounded-xl px-4 text-lg font-semibold transition disabled:opacity-50'
const card = (on: boolean) => `flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border-2 px-4 text-start text-base ${on ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`

export function QuickSendDialog({ templates, onClose }: { templates: Template[]; onClose: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('who')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<'supplier' | 'customer'>('supplier')
  const [templateId, setTemplateId] = useState(templates.length === 1 ? templates[0].id : '')
  const [channel, setChannel] = useState<Channel>('sms')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ agreementId: string; delivered: boolean; deliveryError: string | null; whatsapp: { sendId: string; url: string; text: string } | null } | null>(null)
  const [confirmed, setConfirmed] = useState<boolean | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // One id per action: a retry after a timeout reuses it, so the server sends once.
  const operationId = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    return () => {
      document.removeEventListener('keydown', escape)
      clearTimeout(t)
    }
  }, [onClose])

  useEffect(() => {
    if (mode !== 'existing') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setResults(Array.isArray(d?.companies) ? d.companies : []))
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, mode])

  const recipientName = company ? company.name : name.trim()
  const recipientPhone = company ? company.contactPhone : phone.trim() || null
  const recipientEmail = company ? company.contactEmail : email.trim() || null

  function next() {
    setError(null)
    if (step === 'who') {
      if (mode === 'existing' && !company) return setError('בחרו ספק או לקוח מהרשימה, או עברו ל"נמען חדש".')
      if (mode === 'new' && !name.trim()) return setError('הזינו שם.')
      if (mode === 'new' && !phone.trim() && !email.trim()) return setError('הזינו טלפון או אימייל.')
      setStep('what')
    } else if (step === 'what') {
      if (!templateId) return setError('בחרו מסמך.')
      setStep('how')
    }
  }

  async function send() {
    setError(null)
    if (channel === 'email' && !recipientEmail) return setError('לנמען אין אימייל. בחרו SMS או WhatsApp, או השלימו אימייל.')
    if (channel !== 'email' && !recipientPhone) return setError('לנמען אין טלפון. בחרו אימייל, או השלימו טלפון.')
    setBusy(true)
    try {
      const response = await fetch('/api/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operationId.current, recipient: company ? { companyId: company.id } : { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, kind }, templateId, channel }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        setError(data?.error?.message ?? 'השליחה נכשלה.')
        return
      }
      setResult(data)
      if (data.whatsapp) window.open(data.whatsapp.url, '_blank', 'noopener')
      setStep('done')
      router.refresh()
    } catch {
      setError('השליחה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmWhatsapp(sent: boolean) {
    if (!result?.whatsapp) return
    await fetch(`/api/sends/${result.whatsapp.sendId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent }) }).catch(() => null)
    setConfirmed(sent)
    router.refresh()
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'who', label: 'למי' },
    { key: 'what', label: 'מה' },
    { key: 'how', label: 'איך' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="qs-title" className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="qs-title" className="text-xl font-bold text-fg">
              {step === 'done' ? 'המסמך נשלח' : 'שלח מסמך לחתימה'}
            </h2>
            {step !== 'done' ? (
              <ol className="mt-2 flex gap-2 text-xs text-muted" aria-label="שלבים">
                {steps.map((s, i) => (
                  <li key={s.key} className={`rounded-full px-2 py-0.5 ${step === s.key ? 'bg-brand text-white' : 'bg-bg'}`}>
                    {i + 1}. {s.label}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="סגירה" className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-fg">
            ✕
          </button>
        </div>

        {step === 'who' ? (
          <div className="mt-4 space-y-4">
            <div role="radiogroup" aria-label="סוג נמען" className="grid grid-cols-2 gap-2">
              <label className={card(mode === 'existing')}>
                <input type="radio" name="qs-mode" className="sr-only" checked={mode === 'existing'} onChange={() => setMode('existing')} />
                ספק/לקוח קיים
              </label>
              <label className={card(mode === 'new')}>
                <input type="radio" name="qs-mode" className="sr-only" checked={mode === 'new'} onChange={() => { setMode('new'); setCompany(null) }} />
                נמען חדש
              </label>
            </div>

            {mode === 'existing' ? (
              <div>
                <label className="block text-sm">
                  <span className="font-medium text-fg">חיפוש לפי שם, ח.פ. או טלפון</span>
                  <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} className={input} autoComplete="off" />
                </label>
                <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {results.length === 0 ? <li className="px-4 py-3 text-sm text-muted">{query ? 'לא נמצא. אפשר לשלוח כ"נמען חדש".' : 'הקלידו כדי לחפש.'}</li> : null}
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setCompany(c)} className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-start text-sm ${company?.id === c.id ? 'bg-blue-50' : 'hover:bg-bg'}`}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{c.name}</span>
                          <span className="block truncate text-xs text-muted" dir="ltr">
                            {c.contactPhone ?? c.contactEmail ?? 'אין פרטי קשר'}
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-1 text-xs">
                          <span className="rounded-full bg-bg px-2 py-0.5 text-muted">{c.kind === 'customer' ? 'לקוח' : 'ספק'}</span>
                          <span className={`rounded-full px-2 py-0.5 ${c.fromCrm ? 'bg-blue-100 text-blue-800' : 'bg-bg text-muted'}`}>{c.fromCrm ? 'CRM' : 'XTRA'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-fg">שם העסק או האדם</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={input} maxLength={120} autoComplete="off" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-fg">טלפון נייד</span>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} inputMode="tel" dir="ltr" placeholder="050-0000000" autoComplete="off" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-fg">אימייל</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className={input} inputMode="email" dir="ltr" autoComplete="off" />
                  </label>
                </div>
                <div role="radiogroup" aria-label="ספק או לקוח" className="grid grid-cols-2 gap-2">
                  <label className={card(kind === 'supplier')}>
                    <input type="radio" name="qs-kind" className="sr-only" checked={kind === 'supplier'} onChange={() => setKind('supplier')} />
                    ספק
                  </label>
                  <label className={card(kind === 'customer')}>
                    <input type="radio" name="qs-kind" className="sr-only" checked={kind === 'customer'} onChange={() => setKind('customer')} />
                    לקוח
                  </label>
                </div>
                <p className="text-xs text-muted">לא נוצר ספק או לקוח במאגר. אחרי החתימה אפשר להוסיף בלחיצה.</p>
              </div>
            )}
          </div>
        ) : null}

        {step === 'what' ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted">
              שולחים אל <span className="font-medium text-fg">{recipientName}</span>
            </p>
            {templates.length === 0 ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">אין עדיין תבניות עם שדה חתימה. אפשר להעלות PDF בתהליך המלא.</p> : null}
            <div role="radiogroup" aria-label="מסמך" className="space-y-2">
              {templates.map((t) => (
                <label key={t.id} className={card(templateId === t.id)}>
                  <input type="radio" name="qs-template" className="sr-only" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                  <span className="truncate">{t.name}</span>
                  {templateId === t.id ? <span aria-hidden="true">✓</span> : null}
                </label>
              ))}
            </div>
            <Link href={company ? `/documents/new?company=${company.id}` : '/documents/new'} className="inline-block text-sm text-brand underline">
              {company ? 'להעלות PDF אחר במקום' : 'להעלות PDF (דרך התהליך המלא)'}
            </Link>
          </div>
        ) : null}

        {step === 'how' ? (
          <div className="mt-4 space-y-4">
            <div role="radiogroup" aria-label="ערוץ שליחה" className="grid grid-cols-3 gap-2">
              {(
                [
                  ['sms', 'SMS', Boolean(recipientPhone)],
                  ['email', 'אימייל', Boolean(recipientEmail)],
                  ['whatsapp', 'WhatsApp', Boolean(recipientPhone)],
                ] as const
              ).map(([key, label, possible]) => (
                <label key={key} className={`${card(channel === key)} justify-center ${possible ? '' : 'opacity-50'}`}>
                  <input type="radio" name="qs-channel" className="sr-only" checked={channel === key} onChange={() => setChannel(key)} disabled={!possible} />
                  {label}
                </label>
              ))}
            </div>
            <div className="rounded-xl border border-line bg-bg p-4 text-sm text-fg">
              <p className="text-xs text-muted">כך זה ייראה:</p>
              <p className="mt-1">שלום {recipientName}, מחכה לך מסמך לחתימה מ-XTRA: {templates.find((t) => t.id === templateId)?.name}</p>
              <p className="mt-1 text-xs text-muted" dir="ltr">
                → {channel === 'email' ? recipientEmail : recipientPhone}
              </p>
            </div>
            <p className="text-xs text-muted">{channel === 'whatsapp' ? 'WhatsApp נפתח אצלכם עם ההודעה מוכנה; אחרי השליחה תאשרו כאן שההודעה יצאה.' : 'החותם מקבל קישור אישי, מאמת בקוד לטלפון, ממלא מה שחסר וחותם.'}</p>
          </div>
        ) : null}

        {step === 'done' && result ? (
          <div className="mt-4 space-y-4">
            {result.whatsapp ? (
              confirmed === null ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-base font-semibold text-amber-900">WhatsApp נפתח עם ההודעה. ההודעה נשלחה?</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => void confirmWhatsapp(true)} className={`${big} bg-brand text-white`}>
                      כן, נשלחה
                    </button>
                    <button type="button" onClick={() => void confirmWhatsapp(false)} className={`${big} border border-line bg-surface text-fg`}>
                      לא נשלחה
                    </button>
                  </div>
                  <a href={result.whatsapp.url} target="_blank" rel="noopener noreferrer" className="mt-3 block text-sm underline">
                    WhatsApp לא נפתח? לחצו כאן
                  </a>
                </div>
              ) : (
                <p className={`rounded-xl px-4 py-3 text-base ${confirmed ? 'border border-green-200 bg-green-50 text-green-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>{confirmed ? '✓ סומן כנשלח.' : 'סומן כלא נשלח. אפשר לשלוח שוב מהמסמך.'}</p>
              )
            ) : result.delivered ? (
              <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-base text-green-900">✓ נשלח אל {recipientName}. נעדכן כשייחתם.</p>
            ) : (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-900">המסמך נוצר, אבל ההודעה לא יצאה: {result.deliveryError ?? 'השליחה נכשלה.'} אפשר לשלוח שוב מהמסמך.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href={`/documents/${result.agreementId}`} className={`${big} bg-brand text-white`}>
                פתח את המסמך
              </Link>
              <button type="button" onClick={onClose} className={`${big} border border-line bg-surface text-fg hover:border-brand`}>
                סגירה
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {step !== 'done' ? (
          <div className="mt-5 flex gap-2">
            {step !== 'who' ? (
              <button type="button" onClick={() => setStep(step === 'how' ? 'what' : 'who')} className={`${big} border border-line bg-surface text-fg hover:border-brand`}>
                חזרה
              </button>
            ) : null}
            {step === 'how' ? (
              <button type="button" disabled={busy} onClick={() => void send()} className={`${big} flex-1 bg-brand text-white hover:opacity-90`}>
                {busy ? 'שולחים…' : channel === 'whatsapp' ? 'פתיחת WhatsApp' : 'שליחה'}
              </button>
            ) : (
              <button type="button" onClick={next} className={`${big} flex-1 bg-brand text-white hover:opacity-90`}>
                המשך
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
