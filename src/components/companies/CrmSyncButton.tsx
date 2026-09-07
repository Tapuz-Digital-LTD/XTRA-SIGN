'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * "סנכרון עכשיו" on a CRM-linked record: pulls what changed in Fireberry
 * since the last sync (the same incremental sync as the list's button),
 * then reloads the page so the card shows the fresh values. Read-only
 * towards the CRM — nothing is written there.
 */
export function CrmSyncButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function sync() {
    setBusy(true)
    setMsg(null)
    try {
      const response = await fetch('/api/crm/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMsg({ tone: 'error', text: data?.error?.message ?? 'הסנכרון נכשל.' })
        return
      }
      const n = typeof data?.imported === 'number' ? data.imported : typeof data?.updated === 'number' ? data.updated : null
      setMsg({ tone: 'ok', text: n === null ? 'הסנכרון הושלם.' : `הסנכרון הושלם (${n} רשומות עודכנו).` })
      router.refresh()
    } catch {
      setMsg({ tone: 'error', text: 'הסנכרון נכשל. בדקו את החיבור לאינטרנט.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void sync()} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50">
        {busy ? 'מסנכרן…' : '↻ סנכרון עכשיו'}
      </button>
      {msg ? <span role={msg.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</span> : null}
    </div>
  )
}
