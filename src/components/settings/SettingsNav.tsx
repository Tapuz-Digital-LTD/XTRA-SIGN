'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Moving between the settings screens.
 *
 * Added because there were two of them and no way to get from one to the
 * other: /settings sends you to the first, and without this the second is
 * reachable only by typing the URL.
 */
const TABS = [
  { href: '/settings/organization', label: 'פרטי הארגון ומיתוג' },
  { href: '/settings/users', label: 'משתמשים' },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="mt-4 flex gap-1 rounded-lg bg-bg p-1" aria-label="הגדרות">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-sm transition ${
              active ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
