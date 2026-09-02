'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { describeActivity } from '@/lib/relative-time'
import type { NotificationItem } from '@/server/notifications/notifications'

const ICON: Record<string, string> = {
  signed: '✓',
  declined: '✕',
  expired: '⏱',
  send_failed: '!',
  crm_failed: '!',
}

const TONE: Record<string, string> = {
  signed: 'text-green-700',
  declined: 'text-red-700',
  expired: 'text-amber-700',
  send_failed: 'text-red-700',
  crm_failed: 'text-red-700',
}

/**
 * What happened while you were not looking.
 *
 * Every entry links to the document it is about, so the badge always leads
 * somewhere rather than just asserting that something occurred. Polled rather
 * than pushed: a signature arrives minutes apart at best, and a socket to keep
 * open would be infrastructure bought for nothing.
 */
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      const response = await fetch('/api/notifications')
      if (!response.ok) return
      const data = await response.json()
      setItems(data.items ?? [])
      setUnread(data.unread ?? 0)
    } catch {
      // A failed poll is not worth telling anyone about; the next one may work.
    }
  }

  useEffect(() => {
    // Deferred off the effect's synchronous pass, so the first fetch's state
    // update cannot re-render before the browser has painted.
    const first = setTimeout(() => void load(), 0)
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function markAll() {
    await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    setUnread(0)
    setItems((current) => current.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })))
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
        aria-label={unread > 0 ? `התראות, ${unread} חדשות` : 'התראות'}
        aria-expanded={open}
        className="relative inline-flex size-11 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg"
      >
        <span aria-hidden="true" className="text-lg">🔔</span>
        {unread > 0 ? (
          <span className="absolute end-1.5 top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 z-40 mt-1 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b border-line px-3">
            <span className="text-sm font-semibold text-fg">התראות</span>
            {unread > 0 ? (
              <button type="button" onClick={() => void markAll()} className="text-xs text-brand hover:underline">
                סימון הכול כנקרא
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">אין התראות חדשות.</p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const body = (
                    <>
                      <span className={`mt-0.5 shrink-0 ${TONE[item.type] ?? 'text-muted'}`} aria-hidden="true">
                        {ICON[item.type] ?? '•'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-fg">{item.title}</span>
                        {item.body ? <span className="block truncate text-xs text-muted">{item.body}</span> : null}
                        <span className="block text-xs text-muted">
                          {describeActivity(new Date(item.createdAt), null, new Date())}
                        </span>
                      </span>
                      {!item.readAt ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" /> : null}
                    </>
                  )
                  return (
                    <li key={item.id}>
                      {item.agreementId ? (
                        <Link
                          href={`/documents/${item.agreementId}`}
                          onClick={() => setOpen(false)}
                          className="flex gap-2 px-3 py-3 transition hover:bg-bg"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-2 px-3 py-3">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
