'use client'

import { useCallback, useEffect, useState } from 'react'
import { CHANNEL_LABELS, STATUS_LABELS, type DistributionListItem } from '@/lib/distributions'
import type { CampaignKind } from '@/lib/campaigns'
import { DistributionWizard } from './DistributionWizard'

/**
 * "הפצות": every send the campaign made, and the door to a new one. The
 * list loads on its own so the button works the moment the tab opens —
 * with nothing sent yet, on a phone, or after a failed load.
 */
export function DistributionsTab({
  projectId,
  campaignKind,
  publicUrl,
  isAdmin,
  openNew = false,
}: {
  projectId: string
  campaignKind: CampaignKind
  publicUrl: string | null
  isAdmin: boolean
  openNew?: boolean
}) {
  const [items, setItems] = useState<DistributionListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wizard, setWizard] = useState(openNew)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/distributions`)
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { distributions?: DistributionListItem[] }
      setItems(data?.distributions ?? [])
    } catch {
      setItems([])
      setError('טעינת ההפצות נכשלה.')
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, what: 'send' | 'delete') {
    setBusyId(id)
    setFlash(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/distributions/${id}${what === 'send' ? '/send' : ''}`, { method: what === 'send' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: what === 'send' ? '{}' : undefined })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setFlash(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      if (what === 'send') setFlash(`נשלח ל-${data.stats.sent} נמענים${data.stats.failed ? `, ${data.stats.failed} נכשלו` : ''}${data.skippedRecent ? `, ${data.skippedRecent} דולגו (נשלח להם לאחרונה)` : ''}.`)
      await load()
    } catch {
      setFlash('הפעולה נכשלה. נסו שוב.')
    } finally {
      setBusyId(null)
    }
  }

  const newButton = (
    <button type="button" onClick={() => setWizard(true)} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-white transition-colors hover:opacity-90">
      <span aria-hidden="true" className="me-1">+</span>הפצה חדשה
    </button>
  )

  return (
    <div>
      {wizard ? (
        <DistributionWizard
          projectId={projectId}
          publicUrl={publicUrl}
          isAdmin={isAdmin}
          onClose={() => setWizard(false)}
          onDone={({ sent }) => {
            setWizard(false)
            setFlash(sent ? 'ההפצה נשלחה.' : 'ההפצה נשמרה כטיוטה.')
            void load()
          }}
        />
      ) : null}

      {flash ? <p role="status" className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{flash}</p> : null}
      {error ? (
        <p role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => void load()} className="font-medium underline">נסו שוב</button>
        </p>
      ) : null}

      {items === null ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center text-sm text-muted" aria-busy="true">טוען הפצות…</div>
      ) : items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-fg">עדיין אין הפצות</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            כשתשלחו SMS או אימייל לקהל שבחרתם{campaignKind === 'public' ? ' עם הקישור לעמוד הקמפיין' : ''}, ההפצה תופיע כאן עם מי קיבל ומי לא.
          </p>
          <div className="mt-6">{newButton}</div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted">{items.length} הפצות</p>
            {newButton}
          </div>
          <ul className="flex flex-col gap-2">
            {items.map((d) => (
              <li key={d.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{d.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {d.channels.map((c) => CHANNEL_LABELS[c]).join(' + ')} · {new Date(d.sentAt ?? d.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.status === 'sent' ? 'bg-green-100 text-green-800' : d.status === 'failed' ? 'bg-red-100 text-red-800' : d.status === 'sending' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{STATUS_LABELS[d.status]}</span>
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  <div><dt className="text-muted">נמענים</dt><dd className="text-base font-semibold text-fg">{d.stats.total}</dd></div>
                  <div><dt className="text-muted">נשלחו</dt><dd className="text-base font-semibold text-fg">{d.stats.sent}</dd></div>
                  <div><dt className="text-muted">נכשלו</dt><dd className="text-base font-semibold text-fg">{d.stats.failed}</dd></div>
                  <div><dt className="text-muted">דולגו</dt><dd className="text-base font-semibold text-fg">{d.stats.skipped}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-muted">נתוני מסירה ופתיחה מ-Inforu: הנתון עדיין לא זמין.</p>
                {d.status === 'draft' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void act(d.id, 'send')} disabled={busyId !== null} className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">{busyId === d.id ? 'שולח…' : 'שלח עכשיו'}</button>
                    <button type="button" onClick={() => void act(d.id, 'delete')} disabled={busyId !== null} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm text-fg disabled:opacity-50">מחק טיוטה</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
