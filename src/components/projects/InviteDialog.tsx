'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * "שליחת הזמנה": name → phone or email → channel → send. Four fields, one
 * screen, no supplier created. If the phone or email is already in the
 * campaign the rep sees who, and chooses to send again instead of inviting
 * twice. WhatsApp opens the rep's own app, and only their word marks it sent.
 */
type Channel = 'sms' | 'email' | 'whatsapp'
type Existing = { id: string; name: string; status: string; matchedOn: 'phone' | 'email' }
type Stage = 'form' | 'sent' | 'whatsapp'

const STATUS_WORD: Record<string, string> = { invited: 'הוזמן', registered: 'נרשם', awaiting_signature: 'ממתין לחתימה', signed: 'חתם', failed: 'נכשל' }
const input = 'mt-1 w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg outline-none focus:border-brand'

/** Mounted only while open, so every opening starts clean. */
export function InviteDialog({ projectId, askKind, onClose }: { projectId: string; askKind: boolean; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<'supplier' | 'customer' | ''>('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [existing, setExisting] = useState<Existing[]>([])
  const [ignoreExisting, setIgnoreExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('form')
  const [result, setResult] = useState<{ leadId: string; link: string | null; whatsapp?: { sendId: string; url: string; text: string }; sendOk?: boolean; sendMessage?: string } | null>(null)
  const [confirmed, setConfirmed] = useState<boolean | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // One id per action; a retry after a timeout reuses it and the server creates and sends once.
  const operationId = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 50)
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])

  async function checkExisting() {
    const p = new URLSearchParams()
    if (phone.trim()) p.set('phone', phone.trim())
    if (email.trim()) p.set('email', email.trim())
    if (!p.toString()) return
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations?${p}`)
      const data = await response.json().catch(() => null)
      setExisting(Array.isArray(data?.existing) ? data.existing : [])
      setIgnoreExisting(false)
    } catch {
      setExisting([])
    }
  }

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('הזינו שם.')
    if (channel === 'email' && !email.trim()) return setError('לשליחה באימייל צריך כתובת אימייל.')
    if (channel !== 'email' && !phone.trim()) return setError('לשליחה ב-SMS או ב-WhatsApp צריך מספר טלפון.')
    if (askKind && !kind) return setError('בחרו אם זה ספק או לקוח.')
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operationId.current, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, kind: kind || null, channel }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו ליצור את ההזמנה.')
        return
      }
      setResult({ leadId: data.invitation.id, link: data.invitation.link, whatsapp: data.whatsapp, sendOk: data.send?.ok, sendMessage: data.send?.message })
      if (data.whatsapp) {
        window.open(data.whatsapp.url, '_blank', 'noopener')
        setStage('whatsapp')
      } else {
        setStage('sent')
      }
      router.refresh()
    } catch {
      setError('לא הצלחנו לשלוח. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function resendExisting(leadId: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/invitations/${leadId}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, attemptKey: `${operationId.current}:${channel}` }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השליחה נכשלה.')
        return
      }
      setResult({ leadId, link: null, whatsapp: data.whatsapp, sendOk: !data.whatsapp })
      if (data.whatsapp) {
        window.open(data.whatsapp.url, '_blank', 'noopener')
        setStage('whatsapp')
      } else setStage('sent')
      router.refresh()
    } catch {
      setError('השליחה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmWhatsapp(sent: boolean) {
    if (!result?.whatsapp) return
    setBusy(true)
    try {
      await fetch(`/api/sends/${result.whatsapp.sendId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent }) })
      setConfirmed(sent)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    operationId.current = crypto.randomUUID()
    setName('')
    setPhone('')
    setEmail('')
    setKind('')
    setExisting([])
    setResult(null)
    setConfirmed(null)
    setStage('form')
    setError(null)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="inv-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="inv-title" className="text-xl font-bold text-fg">
            {stage === 'form' ? 'שליחת הזמנה' : stage === 'whatsapp' ? 'ההודעה נשלחה ב-WhatsApp?' : 'ההזמנה נשלחה'}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-fg">
            ✕
          </button>
        </div>

        {stage === 'form' ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            noValidate
          >
            <label className="block text-sm">
              <span className="font-medium text-fg">שם העסק או איש הקשר</span>
              <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="off" maxLength={120} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-fg">טלפון נייד</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => void checkExisting()} className={input} inputMode="tel" dir="ltr" placeholder="050-0000000" autoComplete="off" />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-fg">אימייל</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => void checkExisting()} className={input} inputMode="email" dir="ltr" autoComplete="off" />
              </label>
            </div>
            {askKind ? (
              <div role="radiogroup" aria-label="ספק או לקוח" className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['supplier', 'ספק'],
                    ['customer', 'לקוח'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 text-base font-semibold ${kind === key ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`}>
                    <input type="radio" name="inv-kind" className="sr-only" checked={kind === key} onChange={() => setKind(key)} />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}

            {existing.length > 0 && !ignoreExisting ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">כבר בקמפיין:</p>
                <ul className="mt-2 space-y-2">
                  {existing.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {e.name || 'ללא שם'} · {STATUS_WORD[e.status] ?? e.status} · לפי {e.matchedOn === 'phone' ? 'טלפון' : 'אימייל'}
                      </span>
                      {e.status !== 'signed' ? (
                        <button type="button" disabled={busy} onClick={() => void resendExisting(e.id)} className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">
                          שלח שוב
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setIgnoreExisting(true)} className="mt-3 text-sm font-medium underline">
                  זה מישהו אחר — המשך כהזמנה חדשה
                </button>
              </div>
            ) : null}

            <div role="radiogroup" aria-label="ערוץ שליחה" className="grid grid-cols-3 gap-2">
              {(
                [
                  ['sms', 'SMS'],
                  ['email', 'אימייל'],
                  ['whatsapp', 'WhatsApp'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 text-base font-semibold ${channel === key ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`}>
                  <input type="radio" name="inv-channel" className="sr-only" checked={channel === key} onChange={() => setChannel(key)} />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">
              {channel === 'whatsapp' ? 'WhatsApp נפתח בטלפון או במחשב שלכם עם ההודעה מוכנה; אחרי השליחה תאשרו כאן שההודעה יצאה.' : 'ההודעה נשלחת מהנוסח של הקמפיין (הגדרות ← הודעות) עם קישור אישי לעמוד הקמפיין.'}
            </p>

            {error ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={busy || (existing.length > 0 && !ignoreExisting)} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? 'שולחים…' : channel === 'whatsapp' ? 'פתיחת WhatsApp' : 'שליחה'}
            </button>
          </form>
        ) : null}

        {stage === 'sent' && result ? (
          <div className="mt-4 space-y-4">
            {result.sendOk ? (
              <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-base text-green-900">✓ ההזמנה נשלחה אל {name || 'הנמען'}.</p>
            ) : (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-900">
                ההזמנה נשמרה, אבל ההודעה לא יצאה: {result.sendMessage ?? 'השליחה נכשלה.'} אפשר לשלוח שוב מהרשימה.
              </p>
            )}
            {result.link ? (
              <p className="text-sm text-muted">
                קישור אישי: <span dir="ltr" className="break-all font-mono text-xs text-fg">{result.link}</span>
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={reset} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white">
                הזמנה נוספת
              </button>
              <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface text-base font-medium text-fg hover:border-brand">
                סגירה
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'whatsapp' && result?.whatsapp ? (
          <div className="mt-4 space-y-4">
            <p className="text-base text-fg">WhatsApp נפתח עם ההודעה מוכנה. אחרי שלחצתם שם על שליחה, סמנו כאן מה קרה:</p>
            {confirmed === null ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={busy} onClick={() => void confirmWhatsapp(true)} className="inline-flex min-h-14 items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-50">
                  כן, ההודעה נשלחה
                </button>
                <button type="button" disabled={busy} onClick={() => void confirmWhatsapp(false)} className="inline-flex min-h-14 items-center justify-center rounded-xl border border-line bg-surface text-lg font-medium text-fg hover:border-brand disabled:opacity-50">
                  לא נשלחה
                </button>
              </div>
            ) : (
              <p className={`rounded-xl px-4 py-3 text-base ${confirmed ? 'border border-green-200 bg-green-50 text-green-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
                {confirmed ? '✓ סומן כנשלח.' : 'סומן כלא נשלח. אפשר לנסות שוב מהרשימה.'}
              </p>
            )}
            <a href={result.whatsapp.url} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-brand underline">
              WhatsApp לא נפתח? לחצו כאן
            </a>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={reset} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface text-base font-medium text-fg hover:border-brand">
                הזמנה נוספת
              </button>
              <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface text-base font-medium text-fg hover:border-brand">
                סגירה
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
