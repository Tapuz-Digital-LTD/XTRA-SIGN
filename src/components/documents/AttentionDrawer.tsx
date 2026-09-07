'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Drawer } from '@/components/ui/Drawer'
import type { AttentionReason } from '@/server/attention/attention'
import type { DocumentListItem } from '@/server/documents/queries'

/**
 * "דורשים טיפול", for one document: what happened → what to do → the button.
 *
 * The signature and the message are two different facts. Nothing here ever
 * suggests signing again or a new agreement because a mail did not go out.
 * Provider errors stay behind "פרטי התקלה"; the primary text is in words.
 */

export type AttentionDoc = Pick<DocumentListItem, 'id' | 'title' | 'recipientName' | 'recipientEmail' | 'recipientPhone' | 'attention'>

type Attempt = {
  id: string
  sentAt: string
  channel: string
  event: string
  to: string
  ok: boolean
  error: string | null
  retryOf: string | null
  resolvedAt: string | null
  resolvedNote: string | null
  manualState: string | null
}

export const SEVERITY_CLASS: Record<AttentionReason['severity'], string> = {
  1: 'text-red-700',
  2: 'text-amber-800',
  3: 'text-muted',
}

const EVENT_TEXT: Record<string, string> = {
  invitation: 'קישור חתימה',
  reminder: 'תזכורת',
  signed_confirmation: 'עותק חתום',
  registration_completed: 'אישור הרשמה',
  test: 'בדיקה',
}
const CHANNEL_TEXT: Record<string, string> = { sms: 'SMS', email: 'מייל', whatsapp: 'WhatsApp' }

const BUTTON = 'inline-flex items-center justify-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const SECONDARY = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm text-fg transition hover:bg-bg disabled:opacity-50'

async function post(url: string, body?: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  return { ok: response.ok, data }
}

const errorOf = (data: { error?: { message?: string } } | null, fallback = 'הפעולה נכשלה.') => data?.error?.message ?? fallback

/** Runs one action. Either somewhere to go, a word of confirmation, or what went wrong. */
export async function performAttentionAction(
  doc: AttentionDoc,
  reason: AttentionReason,
  to?: string,
): Promise<{ ok: true; href?: string; message?: string } | { ok: false; message: string }> {
  const { action } = reason
  const channels = [doc.recipientPhone ? 'sms' : null, doc.recipientEmail ? 'email' : null].filter(Boolean)
  switch (action.kind) {
    case 'resend_message':
    case 'fix_email':
    case 'fix_phone': {
      // WhatsApp goes out from the rep's own phone: the share lives on the document.
      if (action.channel === 'whatsapp') return { ok: true, href: `/documents/${doc.id}` }
      const r = await post(`/api/documents/${doc.id}/resend-message`, { sendId: action.sendId, to })
      return r.ok ? { ok: true, message: 'נשלח.' } : { ok: false, message: errorOf(r.data) }
    }
    case 'renew_link': {
      const r = await post(`/api/documents/${doc.id}/renew`, { channels })
      return r.ok ? { ok: true, message: 'הקישור חודש ונשלח.' } : { ok: false, message: errorOf(r.data) }
    }
    case 'remind': {
      if (channels.length === 0) return { ok: false, message: 'לחותם אין טלפון או מייל.' }
      const r = await post(`/api/documents/${doc.id}/remind`, { channels })
      return r.ok ? { ok: true, message: 'התזכורת נשלחה.' } : { ok: false, message: errorOf(r.data) }
    }
    case 'link_company':
      return { ok: true, href: `/documents/${doc.id}` }
    default:
      return { ok: true }
  }
}

/** The one button a reason asks for. Safe inside a clickable row: it swallows the click. */
export function AttentionAction({ doc, reason, onDone, minHeight = 'min-h-9' }: { doc: AttentionDoc; reason: AttentionReason; onDone?: () => void; minHeight?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (reason.action.kind === 'none' || !reason.canActNow) return null
  const needsFix = reason.action.kind === 'fix_email' || reason.action.kind === 'fix_phone'
  const fixChannel = reason.action.channel === 'sms' ? 'sms' : 'email'

  async function run(to?: string) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await performAttentionAction(doc, reason, to)
      if (!result.ok) {
        setMessage({ ok: false, text: result.message })
        return
      }
      setFixing(false)
      if (result.href) {
        router.push(result.href)
        return
      }
      if (result.message) setMessage({ ok: true, text: result.message })
      router.refresh()
      onDone?.()
    } catch {
      setMessage({ ok: false, text: 'הפעולה נכשלה. בדקו את החיבור לאינטרנט.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={() => (needsFix ? setFixing(true) : void run())} className={`${BUTTON} ${minHeight}`}>
        {busy ? 'שולח…' : reason.action.label}
      </button>
      {message ? (
        <span role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-green-800' : 'text-red-700'}`}>
          {message.text}
        </span>
      ) : null}
      {fixing ? (
        <FixDialog
          channel={fixChannel}
          initial={fixChannel === 'sms' ? doc.recipientPhone : doc.recipientEmail}
          busy={busy}
          error={message && !message.ok ? message.text : null}
          onClose={() => setFixing(false)}
          onSubmit={(to) => void run(to)}
        />
      ) : null}
    </span>
  )
}

/** One field, prefilled with what is there now, and "שלח שוב". The fix is saved on the signer too. */
function FixDialog({ channel, initial, busy, error, onClose, onSubmit }: { channel: 'sms' | 'email'; initial: string | null; busy: boolean; error: string | null; onClose: () => void; onSubmit: (to: string) => void }) {
  const [value, setValue] = useState(initial ?? '')
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(value)
        }}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="fix-title" className="text-base font-semibold text-fg">
          {channel === 'sms' ? 'תיקון מספר טלפון' : 'תיקון כתובת מייל'}
        </h2>
        <p className="mt-1 text-sm text-muted">ההודעה תישלח שוב לכתובת המתוקנת, והכתובת תישמר על החותם.</p>
        <label className="mt-4 block text-sm text-fg">
          {channel === 'sms' ? 'מספר טלפון' : 'כתובת מייל'}
          <input
            type={channel === 'sms' ? 'tel' : 'email'}
            dir="ltr"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY}>
            ביטול
          </button>
          <button type="submit" disabled={busy || !value.trim()} className={`${BUTTON} min-h-11 px-4`}>
            {busy ? 'שולח…' : 'שלח שוב'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

/** What an attempt came to, in words. WhatsApp is what the rep reported — never "delivered". */
function outcomeOf(a: Attempt): { text: string; tone: 'ok' | 'bad' | 'neutral' } {
  if (a.channel === 'whatsapp') {
    if (a.manualState === 'sent') return { text: 'הנציג אישר שנשלח', tone: 'ok' }
    if (a.manualState === 'not_sent') return { text: 'הנציג דיווח שלא נשלח', tone: 'bad' }
    return { text: 'השיתוף נפתח, טרם אושר', tone: 'neutral' }
  }
  return a.ok ? { text: 'נשלח', tone: 'ok' } : { text: 'נכשל', tone: 'bad' }
}

const TONE_CLASS = { ok: 'text-green-800', bad: 'text-red-700', neutral: 'text-muted' } as const

function when(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(iso))
}

export function AttentionDrawer({ doc, open, onClose }: { doc: AttentionDoc | null; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [detail, setDetail] = useState<{ reasons: AttentionReason[]; attempts: Attempt[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const id = doc?.id
  // Bumped after an action, so the attempts list shows what just happened.
  const [tick, setTick] = useState(0)
  const reload = () => setTick((t) => t + 1)

  // Fresh state per document comes from the `key` the table gives this
  // component; the effect only fetches.
  useEffect(() => {
    if (!open || !id) return
    const controller = new AbortController()
    fetch(`/api/documents/${id}/attention`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { reasons?: AttentionReason[]; attempts?: Attempt[]; error?: { message?: string } } | null
        if (!response.ok) throw new Error(errorOf(data, 'לא ניתן לטעון את הפרטים.'))
        setLoadError(null)
        setDetail({
          reasons: (data?.reasons ?? []).map((r) => ({ ...r, occurredAt: r.occurredAt ? new Date(r.occurredAt) : null })),
          attempts: data?.attempts ?? [],
        })
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === 'AbortError') return
        setDetail(null)
        setLoadError(e instanceof Error ? e.message : 'לא ניתן לטעון את הפרטים. בדקו את החיבור לאינטרנט.')
      })
    return () => controller.abort()
  }, [open, id, tick])

  if (!doc) return null

  // The drawer knows more than the row did; until it does, the row's reason is the truth.
  const reasons = detail?.reasons ?? (doc.attention ? [doc.attention] : [])
  const actionable = reasons.filter((r) => r.action.kind !== 'none' && r.canActNow)
  const failures = detail?.attempts.filter((a) => !a.ok && a.error && a.channel !== 'whatsapp') ?? []
  const unresolvedSendId = reasons.find((r) => r.action.sendId && r.action.channel !== 'whatsapp')?.action.sendId ?? null

  async function resolve() {
    if (!unresolvedSendId || !doc) return
    setResolving(true)
    setResolveError(null)
    try {
      const r = await post(`/api/documents/${doc.id}/attention/resolve`, { sendId: unresolvedSendId, note })
      if (!r.ok) {
        setResolveError(errorOf(r.data))
        return
      }
      router.refresh()
      onClose()
    } catch {
      setResolveError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setResolving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="block">
          <span className="block truncate">{doc.title}</span>
          {doc.recipientName ? <span className="block text-xs font-normal text-muted">חותם: {doc.recipientName}</span> : null}
        </span>
      }
    >
      {/* `sm:max-w-lg` spelled out here so Tailwind emits it: the shared Drawer
          builds that class name dynamically and would otherwise stay full-width. */}
      <div className="flex flex-col gap-6 text-sm sm:max-w-lg">
        <p className="text-muted">מה קרה, מה לעשות, ובלחיצה אחת זה מטופל.</p>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">מה קרה</h3>
          {loadError ? (
            <p role="alert" className="mt-2 text-red-700">
              {loadError}
            </p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-3">
            {reasons.map((r) => (
              <li key={`${r.key}-${r.action.sendId ?? ''}`}>
                <p className={`font-semibold ${SEVERITY_CLASS[r.severity]}`}>{r.title}</p>
                <p className="mt-0.5 text-fg">{r.explanation}</p>
              </li>
            ))}
            {reasons.length === 0 && detail ? <li className="text-muted">אין כרגע דבר שדורש טיפול.</li> : null}
          </ul>
        </section>

        {actionable.length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">מה לעשות</h3>
            <div className="mt-2 flex flex-col items-start gap-2">
              {actionable.map((r) => (
                <AttentionAction key={`${r.key}-${r.action.kind}-${r.action.sendId ?? ''}`} doc={doc} reason={r} minHeight="min-h-11" onDone={reload} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">ניסיונות שליחה</h3>
          {!detail && !loadError ? <p className="mt-2 text-muted">טוען…</p> : null}
          {detail && detail.attempts.length === 0 ? <p className="mt-2 text-muted">לא נרשמו הודעות למסמך הזה.</p> : null}
          {detail && detail.attempts.length > 0 ? (
            <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {detail.attempts.map((a) => {
                const outcome = outcomeOf(a)
                return (
                  <li key={a.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex flex-wrap items-center gap-x-2 text-fg">
                      <span className="font-medium">{EVENT_TEXT[a.event] ?? a.event}</span>
                      <span className="text-muted">{CHANNEL_TEXT[a.channel] ?? a.channel}</span>
                      <span className={`font-medium ${TONE_CLASS[outcome.tone]}`}>{outcome.text}</span>
                      {a.retryOf ? <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">ניסיון חוזר</span> : null}
                      {a.resolvedAt ? <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">סומן כטופל</span> : null}
                    </span>
                    <span className="text-xs text-muted">
                      {when(a.sentAt)} · <span dir="ltr">{a.to}</span>
                    </span>
                    {a.resolvedNote ? <span className="text-xs text-muted">הערה: {a.resolvedNote}</span> : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>

        {failures.length > 0 ? (
          <details className="rounded-[var(--radius-card)] border border-line px-3 py-2">
            <summary className="cursor-pointer text-sm text-muted">פרטי התקלה</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {failures.map((a) => (
                <li key={a.id} className="text-xs text-muted">
                  <span>{when(a.sentAt)}: </span>
                  <code dir="ltr" className="break-all">
                    {a.error}
                  </code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {unresolvedSendId ? (
          <section className="border-t border-line pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">סמן כטופל</h3>
            <p className="mt-1 text-muted">טיפלתם בזה בדרך אחרת — טלפון, מייל ידני, עותק מודפס? ציינו איך, וההסכם יצא מהרשימה.</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="למשל: העותק נשלח ידנית מהמייל של המשרד"
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-fg outline-none focus:border-brand"
            />
            {resolveError ? (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {resolveError}
              </p>
            ) : null}
            <button type="button" disabled={resolving} onClick={() => void resolve()} className={`${SECONDARY} mt-2`}>
              {resolving ? 'שומר…' : 'סמן כטופל'}
            </button>
          </section>
        ) : null}
      </div>
    </Drawer>
  )
}
