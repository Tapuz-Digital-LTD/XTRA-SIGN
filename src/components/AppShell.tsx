'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotificationBell } from '@/components/NotificationBell'

/**
 * The primary spaces. Suppliers and customers are kept apart on purpose — a
 * document is reached through the company it concerns, not from one flat list.
 */
const NAV = [
  { href: '/', label: 'בית' },
  { href: '/suppliers', label: 'ספקים' },
  { href: '/customers', label: 'לקוחות' },
  { href: '/projects', label: 'פרויקטים' },
  { href: '/agreements', label: 'הסכמים' },
  { href: '/templates', label: 'תבניות' },
  { href: '/settings', label: 'הגדרות' },
]

/** True for the section the user is in — exact for the dashboard, prefix elsewhere. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  // Document pages live under /documents but belong to the agreements space.
  if (href === '/agreements') return pathname.startsWith('/agreements') || pathname.startsWith('/documents')
  return pathname.startsWith(href)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-dvh bg-bg">
      {/*
        Two rows on mobile, one on desktop. Squeezing the logo, the nav and the
        CTA onto a 375px line wrapped the CTA and left the links under the 44px
        touch minimum.
      */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3 sm:justify-start">
            <Link
              href="/"
              // items-center on the row, not baseline: the wordmark image and
              // the word "SIGN" now share a vertical centre line with the nav,
              // so the logo no longer floats above the menu.
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5"
              aria-label="XTRA SIGN — דף הבית"
            >
              {/* The wordmark is Latin, so it needs its own direction island:
                  inside dir="rtl" its parts otherwise read "Sign XTRA". */}
              <span dir="ltr" className="inline-flex items-center gap-1.5">
                <Image
                  src="/xtra-logo.png"
                  alt="XTRA"
                  width={2039}
                  height={492}
                  priority
                  // Height matched to the "SIGN" cap-height beside it, centred
                  // in the row.
                  className="h-[18px] w-auto"
                />
                <span className="text-lg font-bold leading-none tracking-tight text-fg">
                  SIGN
                </span>
              </span>
            </Link>

            <nav className="hidden flex-1 gap-1 sm:flex" aria-label="ניווט ראשי">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm transition-colors hover:bg-slate-100 hover:text-fg ${
                    isActive(pathname, item.href) ? 'bg-slate-100 font-semibold text-fg' : 'text-muted'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <NotificationBell />

            <Link
              href="/documents/new"
              className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              שלח מסמך לחתימה
            </Link>
          </div>

          {/* Mobile nav: its own row, so every target keeps its full height.
              Scrolls sideways when seven labels outgrow a narrow screen. */}
          <nav className="flex gap-1 overflow-x-auto pb-2 sm:hidden" aria-label="ניווט ראשי">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={`inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-1.5 text-[13px] transition-colors hover:bg-slate-100 hover:text-fg ${
                  isActive(pathname, item.href) ? 'bg-slate-100 font-semibold text-fg' : 'text-muted'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
