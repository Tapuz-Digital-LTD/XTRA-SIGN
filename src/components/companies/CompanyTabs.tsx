import Link from 'next/link'

/** The two faces of a companies space: the list itself, and how it's going. */
export function CompanyTabs({
  base,
  active,
  listLabel,
}: {
  base: '/suppliers' | '/customers'
  active: 'list' | 'reports'
  listLabel: string
}) {
  const tabs = [
    { key: 'list' as const, href: base, label: listLabel },
    { key: 'reports' as const, href: `${base}/reports`, label: 'דוחות' },
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
