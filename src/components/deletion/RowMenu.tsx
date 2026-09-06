'use client'

import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }

/**
 * The "⋯" at the end of a row: a few actions, the risky one last and red.
 * Closes on outside click and on Escape; stops the row's own click.
 */
export function RowMenu({ items, label = 'פעולות נוספות' }: { items: (RowMenuItem | null)[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const visible = items.filter((i): i is RowMenuItem => i !== null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (visible.length === 0) return null

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-10 z-30 w-48 rounded-lg border border-line bg-surface py-1 shadow-lg">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`flex min-h-10 w-full items-center px-3 text-start text-sm transition hover:bg-bg disabled:opacity-50 ${
                item.danger ? 'text-danger' : 'text-fg'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
