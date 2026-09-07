import Link from 'next/link'
import { withSource, type SourceView } from '@/components/companies/SourceSwitch'

/** The two faces of a companies space: the list itself, and how it's going. Both keep the chosen source. */
export function CompanyTabs({
  base,
  active,
  listLabel,
  source = 'xtra',
}: {
  base: '/suppliers' | '/customers'
  active: 'list' | 'reports'
  listLabel: string
  source?: SourceView
}) {
  const tabs = [
    { key: 'list' as const, href: withSource(base, source), label: listLabel },
    { key: 'reports' as const, href: withSource(`${base}/reports`, source), label: 'דוחות' },
  ]
  return (
    <nav className="mt-4 flex gap-1 border-b border-line" aria-label="לשוניות">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm transition ${
            active === tab.key ? 'border-brand font-semibold text-fg' : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
