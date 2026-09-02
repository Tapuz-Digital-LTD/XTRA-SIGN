'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { AgreementStatus } from '@/lib/status'

/**
 * The lifecycle actions for a document: duplicate, start a new version, cancel.
 * Which appear depends on the status — a signed document cannot be cancelled, a
 * draft has nothing to supersede yet.
 */
export function DocumentActions({ documentId, status }: { documentId: string; status: AgreementStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCancel = status === 'sent' || status === 'viewed' || status === 'draft'
  const canNewVersion = status !== 'draft'

  async function run(action: 'duplicate' | 'new-version' | 'cancel') {
    setBusy(action)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${documentId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      if (data?.id) router.push(`/documents/${data.id}/edit`)
      else router.refresh()
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('duplicate')}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === 'duplicate' ? 'משכפל…' : 'שכפול'}
        </button>

        {canNewVersion ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('new-version')}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === 'new-version' ? 'יוצר…' : 'גרסה חדשה'}
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirmCancel(true)}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-danger transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            ביטול המסמך
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {confirmCancel ? (
        <div className="rounded-lg border border-danger/30 bg-red-50 p-3">
          <p className="text-sm text-fg">
            לבטל את המסמך? קישור החתימה יפסיק לעבוד והחותם לא יוכל להשלים את החתימה.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('cancel')}
              className="min-h-11 rounded-lg bg-danger px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === 'cancel' ? 'מבטל…' : 'ביטול המסמך'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm text-fg"
            >
              השארה
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
