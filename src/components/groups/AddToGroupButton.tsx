'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type Group = { id: string; name: string; companyCount: number }

/** Adds a selection of companies to an existing group. */
export function AddToGroupButton({ companyIds, onDone }: { companyIds: string[]; onDone?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void (async () => {
      const response = await fetch('/api/groups')
      if (response.ok) setGroups((await response.json()).groups ?? [])
    })()
  }, [open])

  async function add(groupId: string) {
    setBusy(true)
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', companyIds }),
      })
      const data = await response.json().catch(() => null)
      setMessage(response.ok ? `נוספו ${data?.added ?? 0} חברות` : 'ההוספה נכשלה.')
      if (response.ok) {
        onDone?.()
        router.refresh()
        setTimeout(() => setOpen(false), 900)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setMessage(null)
          setOpen(true)
        }}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg transition hover:border-brand"
      >
        הוספה לפרויקט
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">הוספת {companyIds.length} חברות לפרויקט</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {message ? <p role="status" className="px-4 py-3 text-sm text-fg">{message}</p> : null}
          {groups.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">אין פרויקטים עדיין.</p>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void add(group.id)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-start transition hover:bg-bg disabled:opacity-50"
                  >
                    <span className="truncate text-sm font-medium text-fg">{group.name}</span>
                    <span className="shrink-0 text-xs text-muted">{group.companyCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
