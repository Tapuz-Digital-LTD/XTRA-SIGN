'use client'

import { useRouter } from 'next/navigation'

/**
 * The campaign's areas on a phone: one native select instead of a row of
 * tabs that would be cut off or scroll sideways. Same destinations as the
 * tab row on wide screens.
 */
export function TabPicker({ current, options }: { current: string; options: { key: string; label: string; href: string; badge?: number }[] }) {
  const router = useRouter()
  return (
    <label className="block md:hidden">
      <span className="sr-only">אזור בקמפיין</span>
      <select
        value={current}
        onChange={(e) => {
          const next = options.find((o) => o.key === e.target.value)
          if (next) router.push(next.href)
        }}
        className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base font-semibold text-fg outline-none focus:border-brand"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
            {o.badge ? ` (${o.badge})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
