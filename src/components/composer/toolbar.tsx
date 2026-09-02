'use client'

import type { LucideIcon } from 'lucide-react'

/**
 * The toolbar's building blocks.
 *
 * Every control is an icon with a real accessible name, never a bare glyph: an
 * emoji renders differently on every platform and reads as nothing at all to a
 * screen reader.
 */

export function ToolButton({
  onClick,
  active,
  disabled,
  label,
  Icon,
  text,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  label: string
  Icon?: LucideIcon
  text?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-brand text-white' : 'text-fg hover:bg-slate-100'
      }`}
    >
      {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
      {text ? <span className={Icon ? 'ms-1' : ''}>{text}</span> : null}
    </button>
  )
}

/** A hairline between groups of related controls. */
export function ToolDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
}
