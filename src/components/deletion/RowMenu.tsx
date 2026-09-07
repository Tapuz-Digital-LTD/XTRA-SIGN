'use client'

import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }

/**
 * The "⋯" at the end of a row: a few actions, the risky one last and red.
 * Closes on outside click and on Escape; stops the row's own click.
 *
 * Rendered at the body, measured from the button: tables scroll sideways
 * and clip anything positioned inside them, and a menu on the last rows
 * would otherwise open below the fold of the table.
 */
export function RowMenu({ items, label = 'פעולות נוספות' }: { items: (RowMenuItem | null)[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const visible = items.filter((i): i is RowMenuItem => i !== null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const away = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [open])

  if (visible.length === 0) return null

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const width = 192
          const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width - width))
          const height = visible.length * 40 + 16
          setStyle(r.bottom + height + 8 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 })
          setOpen((v) => !v)
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div ref={menuRef} role="menu" dir="rtl" style={style} onClick={(e) => e.stopPropagation()} className="fixed z-40 w-48 rounded-lg border border-line bg-surface py-1 shadow-lg">
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
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
