'use client'

import { useEffect, useState } from 'react'

/**
 * "הוסף כספק/לקוח" for a tracked person: records that already carry the
 * same tax id, phone or email are shown for a person to confirm — a shared
 * phone is a hint, never proof — and otherwise a local record is created.
 * Nothing is written to the CRM.
 */
type Match = { id: string; name: string; kind: string; fromCrm: boolean; matchedOn: string }
const bigButton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-base font-semibold transition disabled:opacity-50'

export function LinkCompanyPanel({ leadId, onDone, onError, title = 'הוסף כספק/לקוח' }: { leadId: string; onDone: (companyId: string) => void; onError: (message: string) => void; title?: string }) {
  const [matches, setMatches] = useState<Match[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/invitations/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setMatches(Array.isArray(d?.matches) ? d.matches : []))
      .catch(() => live && setMatches([]))
    return () => {
      live = false
    }
  }, [leadId])

  async function choose(choice: { companyId: string } | { kind: 'supplier' | 'customer' }) {
    setBusy(true)
    try {
      const response = await fetch(`/api/invitations/${leadId}/company`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice) })
      const data = await response.json().catch(() => null)
      if (!response.ok) return onError(data?.error?.message ?? 'לא הצלחנו להוסיף.')
      onDone(data.companyId)
    } catch {
      onError('לא הצלחנו להוסיף. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  const matchWord = matches[0]?.matchedOn === 'taxId' ? 'ח.פ.' : matches[0]?.matchedOn === 'phone' ? 'טלפון' : 'אימייל'

  return (
    <section className="rounded-xl border border-line bg-bg p-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {matches.length > 0 ? (
        <div className="mt-2 text-sm text-fg">
          <p className="text-muted">נמצאו רשומות עם אותו {matchWord} — האם זה אותו עסק?</p>
          <ul className="mt-2 space-y-2">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>
                  {m.name} · {m.kind === 'customer' ? 'לקוח' : 'ספק'}
                  {m.fromCrm ? ' · CRM' : ''}
                </span>
                <button type="button" disabled={busy} onClick={() => void choose({ companyId: m.id })} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:border-brand disabled:opacity-50">
                  כן, לקשר
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => void choose({ kind: 'supplier' })} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
          ספק חדש
        </button>
        <button type="button" disabled={busy} onClick={() => void choose({ kind: 'customer' })} className={`${bigButton} border border-line bg-surface text-fg hover:border-brand`}>
          לקוח חדש
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">נשמר ב-XTRA Sign בלבד. שום דבר לא נכתב ל-CRM.</p>
    </section>
  )
}
