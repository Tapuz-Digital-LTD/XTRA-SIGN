'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import type { SearchHit } from '@/server/search/search'

/**
 * "חיפוש ספק, לקוח, קמפיין או מסמך…" in the header. Results grouped by
 * kind, each with its name, the number or contact that identifies it, and
 * a CRM mark where the record is the mirror of one. Keyboard: ↑/↓ moves,
 * Enter opens, Esc closes. On a phone the box lives in the menu drawer.
 */

const KIND_LABELS: Record<SearchHit['kind'], string> = { supplier: 'ספקים', customer: 'לקוחות', campaign: 'קמפיינים', agreement: 'מסמכים', template: 'תבניות' }
const ORDER: SearchHit['kind'][] = ['supplier', 'customer', 'campaign', 'agreement', 'template']

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const listId = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const controller = new AbortController()
    setBusy(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((data: { hits?: SearchHit[] }) => {
          setHits(data?.hits ?? [])
          setActive(0)
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const ordered = ORDER.flatMap((k) => hits.filter((h) => h.kind === k))

  function openHit(hit: SearchHit) {
    setOpen(false)
    setQ('')
    router.push(hit.href)
  }

  return (
    <div ref={box} className={`relative ${compact ? 'w-full' : 'hidden w-64 lg:block xl:w-80'}`}>
      <label className="relative block">
        <span className="sr-only">חיפוש</span>
        <Search aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, ordered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && ordered[active]) {
              e.preventDefault()
              openHit(ordered[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          type="search"
          placeholder="חיפוש ספק, לקוח, קמפיין או מסמך…"
          aria-label="חיפוש ספק, לקוח, קמפיין או מסמך"
          aria-controls={listId}
          aria-expanded={open && q.trim().length >= 2}
          role="combobox"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-line bg-bg pe-9 ps-3 text-sm text-fg outline-none placeholder:text-muted focus:border-brand"
        />
      </label>
      {open && q.trim().length >= 2 ? (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {busy && ordered.length === 0 ? <p className="px-3 py-3 text-sm text-muted">מחפש…</p> : null}
          {!busy && ordered.length === 0 ? <p className="px-3 py-3 text-sm text-muted">לא נמצא דבר עבור "{q.trim()}".</p> : null}
          {ORDER.map((kind) => {
            const group = ordered.filter((h) => h.kind === kind)
            if (group.length === 0) return null
            return (
              <div key={kind} className="py-1">
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{KIND_LABELS[kind]}</p>
                {group.map((hit) => {
                  const index = ordered.indexOf(hit)
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => openHit(hit)}
                      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm ${index === active ? 'bg-brand/10' : 'hover:bg-bg'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{hit.title}</span>
                        {hit.subtitle ? <span className="block truncate text-xs text-muted" dir="auto">{hit.subtitle}</span> : null}
                      </span>
                      {hit.source === 'crm' ? <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">CRM</span> : null}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
