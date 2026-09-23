'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * "שליחת הזמנה": one person, every door at once.
 *
 * A name, the phones and emails they can be reached at, and which channels
 * to use. SMS and email leave from the server to every address in one
 * press, all on the same personal link — whoever opens it first fills the
 * form. WhatsApp cannot be sent for the rep: it opens on their own phone,
 * one number at a time, and every "sent" they confirm opens the next, so a
 * batch of numbers is one tap each. If a phone or email is already in the
 * campaign the rep sees who, and chooses to send again instead of inviting
 * twice.
 */
type Channel = 'sms' | 'email' | 'whatsapp'
type Existing = { id: string; name: string; status: string; matchedOn: 'phone' | 'email' }
type SendRow = { channel: Channel; to: string; ok: boolean; sendId?: string; state?: string; message?: string; whatsapp?: { sendId: string; url: string; text: string } }
/** Where one WhatsApp message stands: waiting for the rep, open on their phone, or as they reported it. */
type WaState = 'ready' | 'opened' | 'sent' | 'not_sent'
type Stage = 'form' | 'done'

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'אימייל' },
]
const CHANNEL_WORD: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'אימייל' }
const STATUS_WORD: Record<string, string> = { invited: 'הוזמן', registered: 'נרשם', awaiting_signature: 'ממתין לחתימה', signed: 'חתם', failed: 'נכשל' }
const MAX_ADDRESSES = 5
const input = 'w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg outline-none focus:border-brand'
const choice = 'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold'
const primary = 'inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-base font-medium text-fg hover:border-brand disabled:opacity-50'
const link = 'inline-flex min-h-11 items-center px-1 text-sm font-medium text-brand underline-offset-4 hover:underline disabled:opacity-50'

const messagesWord = (n: number) => (n === 1 ? 'הודעה אחת' : `${n} הודעות`)

/** Mounted only while open, so every opening starts clean. */
export function InviteDialog({ projectId, askKind, onClose }: { projectId: string; askKind: boolean; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'supplier' | 'customer' | ''>('')
  const [channels, setChannels] = useState<Channel[]>(['sms'])
  const [phones, setPhones] = useState<string[]>([''])
  const [emails, setEmails] = useState<string[]>([''])
  const [existing, setExisting] = useState<Existing[]>([])
  const [ignoreExisting, setIgnoreExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('form')
  const [result, setResult] = useState<{ leadId: string; link: string | null; sends: SendRow[] } | null>(null)
  const [wa, setWa] = useState<Record<string, WaState>>({})
  /** An SMS the rep sent instead of a WhatsApp that did not go, by the WhatsApp send's id. */
  const [instead, setInstead] = useState<Record<string, { ok: boolean; message?: string }>>({})
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

  const wantsPhone = channels.includes('sms') || channels.includes('whatsapp')
  const wantsEmail = channels.includes('email')
  const cleanPhones = [...new Set(phones.map((p) => p.trim()).filter(Boolean))]
  const cleanEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const total = (channels.includes('sms') ? cleanPhones.length : 0) + (channels.includes('whatsapp') ? cleanPhones.length : 0) + (wantsEmail ? cleanEmails.length : 0)

  const toggleChannel = (key: Channel) => {
    setChannels((list) => (list.includes(key) ? list.filter((c) => c !== key) : [...list, key]))
    setError(null)
  }
  const setAt = (set: (f: (list: string[]) => string[]) => void, index: number, value: string) => set((list) => list.map((v, i) => (i === index ? value : v)))
  const removeAt = (set: (f: (list: string[]) => string[]) => void, index: number) => set((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : ['']))

  /** Who already has this address in the campaign — asked as each field is left, merged by person. */
  async function checkExisting(field: 'phone' | 'email', value: string) {
    const v = value.trim()
    if (!v) return
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations?${new URLSearchParams({ [field]: v })}`)
      const data = await response.json().catch(() => null)
      const found: Existing[] = Array.isArray(data?.existing) ? data.existing : []
      if (found.length === 0) return
      setExisting((list) => [...new Map([...list, ...found].map((e) => [e.id, e])).values()])
      setIgnoreExisting(false)
    } catch {
      /* the check is a courtesy; the send itself is guarded on the server */
    }
  }

  /** The WhatsApp messages of a result, in the order they were reserved. */
  const waRows = (sends: SendRow[]) => sends.filter((s) => s.channel === 'whatsapp' && s.ok && s.whatsapp)

  function open(row: SendRow) {
    if (!row.whatsapp) return
    window.open(row.whatsapp.url, '_blank', 'noopener')
    setWa((s) => ({ ...s, [row.whatsapp!.sendId]: 'opened' }))
  }

  function finish(data: { leadId: string; link: string | null; sends: SendRow[] }) {
    setResult(data)
    setWa(Object.fromEntries(waRows(data.sends).map((r) => [r.whatsapp!.sendId, 'ready' as WaState])))
    setInstead({})
    setStage('done')
    // The first WhatsApp opens on the same press that sent everything else.
    const first = waRows(data.sends)[0]
    if (first) open(first)
    router.refresh()
  }

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('הזינו שם.')
    if (channels.length === 0) return setError('בחרו לפחות דרך שליחה אחת.')
    if (wantsPhone && cleanPhones.length === 0) return setError('הזינו לפחות מספר טלפון נייד אחד.')
    if (wantsEmail && cleanEmails.length === 0) return setError('הזינו לפחות כתובת אימייל אחת.')
    if (askKind && !kind) return setError('בחרו אם זה ספק או לקוח.')
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Every address typed is kept on the person; the channels decide what leaves now.
        body: JSON.stringify({ operationId: operationId.current, name: name.trim(), phones: cleanPhones, emails: cleanEmails, kind: kind || null, channels }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו ליצור את ההזמנה.')
        return
      }
      finish({ leadId: data.invitation.id, link: data.invitation.link, sends: Array.isArray(data.sends) ? data.sends : [] })
    } catch {
      setError('לא הצלחנו לשלוח. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  /** Someone already in the campaign: the same message again, on every chosen channel, to their own addresses. */
  async function resendExisting(leadId: string) {
    if (channels.length === 0) return setError('בחרו לפחות דרך שליחה אחת.')
    setBusy(true)
    setError(null)
    try {
      const sends: SendRow[] = []
      for (const channel of ['sms', 'email', 'whatsapp'] as Channel[]) {
        if (!channels.includes(channel)) continue
        const response = await fetch(`/api/invitations/${leadId}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, attemptKey: `${operationId.current}:${channel}:again` }) })
        const data = await response.json().catch(() => null)
        if (!response.ok) sends.push({ channel, to: '', ok: false, message: data?.error?.message ?? 'השליחה נכשלה.' })
        else sends.push({ channel, to: '', ok: true, sendId: data?.sendId ?? data?.whatsapp?.sendId, whatsapp: data?.whatsapp })
      }
      finish({ leadId, link: null, sends })
    } catch {
      setError('השליחה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  /** What the rep saw on their phone — and, on a "sent", the next number opens on the same tap. */
  async function confirmWa(row: SendRow, sent: boolean) {
    if (!row.whatsapp || !result) return
    const id = row.whatsapp.sendId
    setWa((s) => ({ ...s, [id]: sent ? 'sent' : 'not_sent' }))
    if (sent) {
      const next = waRows(result.sends).find((r) => r.whatsapp!.sendId !== id && (wa[r.whatsapp!.sendId] ?? 'ready') === 'ready')
      if (next) open(next)
    }
    try {
      await fetch(`/api/sends/${id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent }) })
      router.refresh()
    } catch {
      /* the mark is best effort; the row still shows what the rep chose */
    }
  }

  /** WhatsApp did not go: the same words by SMS to the same number, and the WhatsApp marked not sent. */
  async function smsInstead(row: SendRow, index: number) {
    if (!row.whatsapp || !result) return
    setBusy(true)
    try {
      await confirmWa(row, false)
      const response = await fetch(`/api/invitations/${result.leadId}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'sms', to: row.to, attemptKey: `${operationId.current}:sms-instead:${index}` }) })
      const data = await response.json().catch(() => null)
      setInstead((s) => ({ ...s, [row.whatsapp!.sendId]: response.ok ? { ok: true } : { ok: false, message: data?.error?.message ?? 'השליחה נכשלה.' } }))
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    operationId.current = crypto.randomUUID()
    setName('')
    setPhones([''])
    setEmails([''])
    setExisting([])
    setIgnoreExisting(false)
    setResult(null)
    setWa({})
    setInstead({})
    setStage('form')
    setError(null)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  const sentAlready = (sends: SendRow[], to: string) => sends.some((s) => s.channel === 'sms' && s.to === to && s.ok)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="inv-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="inv-title" className="text-xl font-bold text-fg">
            {stage === 'form' ? 'שליחת הזמנה' : result && result.sends.some((s) => s.ok) ? 'ההזמנה נשלחה' : 'ההזמנה נשמרה'}
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
              <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} autoComplete="off" maxLength={120} />
            </label>
            {askKind ? (
              <div role="radiogroup" aria-label="ספק או לקוח" className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['supplier', 'ספק'],
                    ['customer', 'לקוח'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={`${choice} ${kind === key ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`}>
                    <input type="radio" name="inv-kind" className="sr-only" checked={kind === key} onChange={() => setKind(key)} />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}

            <fieldset>
              <legend className="block text-sm font-medium text-fg">איך לשלוח? אפשר לסמן כמה.</legend>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {CHANNELS.map((c) => {
                  const on = channels.includes(c.key)
                  return (
                    <label key={c.key} className={`${choice} ${on ? 'border-brand bg-blue-50 text-fg' : 'border-line bg-bg text-fg hover:border-brand'}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleChannel(c.key)} />
                      <span aria-hidden="true" className={`inline-flex size-5 items-center justify-center rounded-md border text-xs ${on ? 'border-brand bg-brand text-white' : 'border-line bg-surface'}`}>
                        {on ? '✓' : ''}
                      </span>
                      {c.label}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {wantsPhone ? (
              <AddressList
                label="מספרי טלפון נייד"
                addLabel="+ עוד מספר"
                values={phones}
                placeholder="050-0000000"
                inputMode="tel"
                onChange={(i, v) => setAt(setPhones, i, v)}
                onBlur={(v) => void checkExisting('phone', v)}
                onRemove={(i) => removeAt(setPhones, i)}
                onAdd={() => setPhones((list) => [...list, ''])}
              />
            ) : null}
            {wantsEmail ? (
              <AddressList
                label="כתובות אימייל"
                addLabel="+ עוד כתובת"
                values={emails}
                placeholder="name@example.com"
                inputMode="email"
                onChange={(i, v) => setAt(setEmails, i, v)}
                onBlur={(v) => void checkExisting('email', v)}
                onRemove={(i) => removeAt(setEmails, i)}
                onAdd={() => setEmails((list) => [...list, ''])}
              />
            ) : null}

            <p className="text-sm text-muted">
              {channels.length === 0
                ? 'בחרו לפחות דרך שליחה אחת.'
                : 'אותו קישור אישי יוצא לכל מספר ולכל כתובת שסימנתם; מי שיפתח ראשון ימלא את הטופס.'}
              {channels.includes('whatsapp') ? ' WhatsApp ייפתח אצלכם מספר אחרי מספר, עם ההודעה מוכנה, ואחרי כל שליחה מסמנים כאן.' : ''}
            </p>

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

            {error ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={busy || (existing.length > 0 && !ignoreExisting)} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? 'שולחים…' : total === 0 ? 'שלח הזמנה' : `שלח הזמנה (${messagesWord(total)})`}
            </button>
          </form>
        ) : null}

        {stage === 'done' && result ? (
          <div className="mt-4 space-y-4">
            {/* What left the server, one line per message, each answering for itself. */}
            {result.sends.some((s) => s.channel !== 'whatsapp') ? (
              <ul className="space-y-2">
                {result.sends
                  .filter((s) => s.channel !== 'whatsapp')
                  .map((s, i) => (
                    <li key={`${s.channel}-${s.to}-${i}`} role={s.ok ? undefined : 'alert'} className={`rounded-xl border px-4 py-3 text-base ${s.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                      {s.ok ? '✓' : '✗'} {CHANNEL_WORD[s.channel]}
                      {s.to ? (
                        <>
                          {' '}
                          אל <span dir="ltr">{s.to}</span>
                        </>
                      ) : null}
                      {s.ok ? '' : ` — ${s.message ?? 'השליחה נכשלה.'}`}
                    </li>
                  ))}
              </ul>
            ) : null}

            {/* WhatsApp: the rep's phone does the sending, one number at a time; each "sent" opens the next. */}
            {waRows(result.sends).length > 0 || result.sends.some((s) => s.channel === 'whatsapp' && !s.ok) ? (
              <section className="rounded-xl border border-line bg-bg p-4" aria-labelledby="inv-wa">
                <h3 id="inv-wa" className="text-base font-semibold text-fg">
                  WhatsApp · {waRows(result.sends).filter((r) => wa[r.whatsapp!.sendId] === 'sent').length} מתוך {waRows(result.sends).length} נשלחו
                </h3>
                <p className="mt-1 text-sm text-muted">כל מספר נפתח אצלכם עם ההודעה מוכנה. אחרי שלחצתם שם על שליחה, סמנו כאן — והבא נפתח מיד.</p>
                <ol className="mt-3 space-y-3">
                  {result.sends
                    .filter((s) => s.channel === 'whatsapp')
                    .map((row, index) => {
                      const id = row.whatsapp?.sendId ?? `failed-${index}`
                      const state: WaState | 'failed' = row.ok && row.whatsapp ? (wa[id] ?? 'ready') : 'failed'
                      const fallback = instead[id]
                      return (
                        <li key={id} className="rounded-xl border border-line bg-surface p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-base font-medium text-fg" dir={row.to ? 'ltr' : undefined}>
                              {row.to || 'המספר הרשום אצלנו'}
                            </span>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${state === 'sent' ? 'bg-green-50 text-green-900' : state === 'not_sent' || state === 'failed' ? 'bg-red-50 text-red-900' : state === 'opened' ? 'bg-amber-50 text-amber-900' : 'bg-bg text-muted'}`}>
                              {state === 'ready' ? 'ממתין' : state === 'opened' ? 'נפתח אצלכם' : state === 'sent' ? 'נשלח' : state === 'not_sent' ? 'לא נשלח' : 'לא נפתח'}
                            </span>
                          </div>
                          {state === 'failed' ? <p className="mt-2 text-sm text-red-900">{row.message ?? 'לא הצלחנו להכין את ההודעה.'}</p> : null}
                          {state === 'ready' ? (
                            <button type="button" onClick={() => open(row)} className={`${secondary} mt-2 w-full`}>
                              פתח WhatsApp למספר הזה
                            </button>
                          ) : null}
                          {state === 'opened' ? (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <button type="button" disabled={busy} onClick={() => void confirmWa(row, true)} className={primary}>
                                {waRows(result.sends).some((r) => r.whatsapp!.sendId !== id && (wa[r.whatsapp!.sendId] ?? 'ready') === 'ready') ? 'כן, נשלח — פתח את הבא' : 'כן, ההודעה נשלחה'}
                              </button>
                              <button type="button" disabled={busy} onClick={() => void confirmWa(row, false)} className={secondary}>
                                לא נשלחה
                              </button>
                              <a href={row.whatsapp!.url} target="_blank" rel="noopener noreferrer" className={link}>
                                WhatsApp לא נפתח? לחצו כאן
                              </a>
                              {!sentAlready(result.sends, row.to) && !fallback ? (
                                <button type="button" disabled={busy} onClick={() => void smsInstead(row, index)} className={link}>
                                  שלח SMS במקום
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {state === 'not_sent' ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {fallback ? (
                                <span className={`text-sm ${fallback.ok ? 'text-green-900' : 'text-red-900'}`}>{fallback.ok ? '✓ נשלח ב-SMS במקום.' : `SMS לא יצא: ${fallback.message}`}</span>
                              ) : (
                                <>
                                  <button type="button" onClick={() => open(row)} className={link}>
                                    פתח שוב
                                  </button>
                                  {!sentAlready(result.sends, row.to) ? (
                                    <button type="button" disabled={busy} onClick={() => void smsInstead(row, index)} className={link}>
                                      שלח SMS במקום
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                </ol>
              </section>
            ) : null}

            {result.link ? (
              <p className="text-sm text-muted">
                קישור אישי: <span dir="ltr" className="break-all font-mono text-xs text-fg">{result.link}</span>
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={reset} className={primary}>
                הזמנה נוספת
              </button>
              <button type="button" onClick={onClose} className={secondary}>
                סגירה
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** A short list of addresses of one kind: one field per line, ✕ to drop a line, "+ עוד" for the next — up to five. */
function AddressList({ label, addLabel, values, placeholder, inputMode, onChange, onBlur, onRemove, onAdd }: { label: string; addLabel: string; values: string[]; placeholder: string; inputMode: 'tel' | 'email'; onChange: (index: number, value: string) => void; onBlur: (value: string) => void; onRemove: (index: number) => void; onAdd: () => void }) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-fg">{label}</legend>
      <div className="mt-1 space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input value={value} onChange={(e) => onChange(index, e.target.value)} onBlur={(e) => onBlur(e.target.value)} className={input} inputMode={inputMode} dir="ltr" placeholder={placeholder} autoComplete="off" aria-label={`${label} ${index + 1}`} />
            {values.length > 1 ? (
              <button type="button" onClick={() => onRemove(index)} aria-label={`הסרת ${label} ${index + 1}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-fg">
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {values.length < MAX_ADDRESSES ? (
        <button type="button" onClick={onAdd} className={link}>
          {addLabel}
        </button>
      ) : null}
    </fieldset>
  )
}
