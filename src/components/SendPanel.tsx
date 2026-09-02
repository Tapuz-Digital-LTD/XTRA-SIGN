'use client'

import { useState } from 'react'
import { RecipientForm } from '@/components/editor/RecipientForm'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp-share'
import type { SendSummary, Channel } from '@/server/documents/send-validation'
import { toIsraeliNationalFormat } from '@/lib/phone'

/**
 * The last screen before sending.
 *
 * A summary and a button, not a settings page. Its only job is to stop a
 * mistake: who it goes to, how, and how many signatures are on it.
 */
export function SendPanel({
  documentId,
  summary,
}: {
  documentId: string
  summary: SendSummary
}) {
  // Default to whatever we can actually reach the signer on.
  const [channels, setChannels] = useState<Channel[]>(() => {
    const initial: Channel[] = []
    if (summary.recipientEmail) initial.push('email')
    if (summary.recipientPhone) initial.push('sms')
    return initial
  })

  const [busy, setBusy] = useState(false)
  const hasRecipient = Boolean(summary.recipientName)
  const [editingRecipient, setEditingRecipient] = useState(false)
  const [blockers, setBlockers] = useState<string[]>(summary.blockers)
  const [result, setResult] = useState<{ channel: string; sent: boolean }[] | null>(null)
  // Held in memory only, for the WhatsApp share on this screen. The raw token
  // is never stored, so navigating away loses it — sharing again means a resend.
  const [signingUrl, setSigningUrl] = useState<string | null>(null)

  function toggle(channel: Channel) {
    setChannels((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel],
    )
  }

  async function send() {
    setBusy(true)
    try {
      const response = await fetch(`/api/documents/${documentId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        setBlockers(data?.blockers ?? [data?.error?.message ?? 'השליחה נכשלה.'])
        return
      }

      setResult(data.deliveries ?? [])
      setSigningUrl(data.signingUrl ?? null)
      // Deliberately NO router.refresh(): the document is no longer a draft, so
      // re-running the server component redirects to the document page and
      // throws away this success state — including the WhatsApp share, which is
      // the only place the signing link is ever shown.
    } catch {
      setBlockers(['השליחה נכשלה. בדקו את החיבור לאינטרנט.'])
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const failed = result.filter((r) => !r.sent)
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        <p className="text-2xl" aria-hidden="true">
          ✓
        </p>
        <h2 className="mt-2 text-lg font-semibold text-fg">המסמך נשלח לחתימה</h2>

        {failed.length > 0 ? (
          // Never claim a channel worked when it did not.
          <p role="alert" className="mt-3 text-sm text-danger">
            השליחה ב{failed.map((f) => (f.channel === 'sms' ? '-SMS' : 'אימייל')).join(' וב')} לא
            הצליחה. ניתן לנסות שוב מעמוד המסמך.
          </p>
        ) : null}

        {signingUrl ? (
          <WhatsAppShareButton
            documentId={documentId}
            name={summary.recipientName ?? ''}
            url={signingUrl}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">הכול מוכן לשליחה</h2>

        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <Row label="מסמך" value={summary.title} />
          <Row
            label="נשלח אל (הנמען)"
            value={summary.recipientName ?? 'טרם הוזנו פרטי נמען'}
          />
          {summary.recipientCompany ? <Row label="חברה" value={summary.recipientCompany} /> : null}
          <Row
            label="שדות למילוי"
            value={`${summary.fieldCount} שדות, ${
              summary.signatureCount === 1 ? 'מתוכם חתימה אחת' : `מתוכם ${summary.signatureCount} חתימות`
            }`}
          />
        </dl>

        <button
          type="button"
          onClick={() => setEditingRecipient((v) => !v)}
          className="mt-3 text-sm text-brand underline-offset-4 hover:underline"
        >
          {hasRecipient ? 'עריכת פרטי הנמען' : 'הוספת פרטי הנמען'}
        </button>
      </div>

      {editingRecipient || !hasRecipient ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-fg">פרטי הנמען — למי לשלוח את המסמך</h3>
          <p className="mt-1 text-xs text-muted">שם החותם, וטלפון או אימייל שאליהם יישלח קישור החתימה.</p>
          <div className="mt-3">
            <RecipientForm
              documentId={documentId}
              initial={{
                name: summary.recipientName ?? '',
                company: summary.recipientCompany,
                phone: summary.recipientPhone,
                email: summary.recipientEmail,
              }}
            />
          </div>
        </div>
      ) : null}

      <fieldset className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <legend className="px-1 text-base font-semibold text-fg">איך לשלוח?</legend>

        <div className="mt-3 flex flex-col gap-2">
          <ChannelOption
            checked={channels.includes('email')}
            onChange={() => toggle('email')}
            label="אימייל"
            detail={summary.recipientEmail}
            missing="לא הוזנה כתובת אימייל"
          />
          <ChannelOption
            checked={channels.includes('sms')}
            onChange={() => toggle('sms')}
            label="SMS"
            detail={toIsraeliNationalFormat(summary.recipientPhone)}
            missing="לא הוזן מספר טלפון"
          />
        </div>

        <p className="mt-3 text-xs text-muted">
          שיתוף ב-WhatsApp זמין לאחר השליחה — הוא פותח את WhatsApp אצלכם עם הודעה מוכנה.
        </p>
      </fieldset>

      {blockers.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-danger/30 bg-red-50 p-4 text-sm text-danger">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={send}
        disabled={busy || channels.length === 0}
        className="min-h-12 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {busy ? 'שולח…' : 'שליחה לחתימה'}
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-end font-medium text-fg">{value}</dd>
    </div>
  )
}

function ChannelOption({
  checked,
  onChange,
  label,
  detail,
  missing,
}: {
  checked: boolean
  onChange: () => void
  label: string
  detail: string | null
  missing: string
}) {
  const available = Boolean(detail)
  return (
    <label
      className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 ${
        available ? 'cursor-pointer border-line bg-white' : 'border-line bg-slate-50 opacity-60'
      }`}
    >
      <input
        type="checkbox"
        checked={checked && available}
        disabled={!available}
        onChange={onChange}
        className="h-4 w-4"
      />
      <span className="text-sm font-medium text-fg">{label}</span>
      <span className="ms-auto truncate text-xs text-muted" dir={available ? 'ltr' : undefined}>
        {detail ?? missing}
      </span>
    </label>
  )
}

/**
 * WhatsApp is a share, never a send.
 *
 * The button opens WhatsApp with a prefilled message; the user picks the
 * contact and presses send there. Nothing here can observe delivery, so the UI
 * says "שיתוף" and the audit event says the share was opened — neither claims
 * anything was received.
 */
function WhatsAppShareButton({
  documentId,
  name,
  url,
}: {
  documentId: string
  name: string
  url: string
}) {
  const [opened, setOpened] = useState(false)

  return (
    <div className="mt-5">
      <a
        href={buildWhatsAppShareUrl({ recipientName: name, signingLink: url })}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          setOpened(true)
          // Records only that the share sheet opened. Fire-and-forget: failing
          // to log must not block the share.
          void fetch(`/api/documents/${documentId}/whatsapp-share`, { method: 'POST' })
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
      >
        שיתוף ב-WhatsApp
      </a>
      {opened ? (
        <p className="mt-2 text-xs text-muted">
          WhatsApp נפתח. ההודעה תישלח רק לאחר שתלחצו שליחה שם.
        </p>
      ) : null}
    </div>
  )
}
