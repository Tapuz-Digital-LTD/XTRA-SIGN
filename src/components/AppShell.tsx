'use client'

import { Menu, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
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
  const [menuOpen, setMenuOpen] = useState(false)

  // Navigating closes the drawer; so does Escape.
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="min-h-dvh bg-bg">
      {/* One row everywhere. On a phone the seven links live in a side drawer
          behind the hamburger — a scrolling strip of tiny tabs was crowding
          the screen it was supposed to organise. */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-2 py-3 sm:justify-start sm:gap-4">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="פתיחת התפריט"
              aria-expanded={menuOpen}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg transition hover:bg-slate-100 sm:hidden"
            >
              <Menu aria-hidden="true" className="size-6" strokeWidth={1.75} />
            </button>

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

            <span className="ms-auto sm:ms-0" />
            <NotificationBell />

            <Link
              href="/documents/new"
              className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg bg-brand px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] sm:px-4"
            >
              <span className="sm:hidden">לחתימה</span>
              <span className="hidden sm:inline">שלח מסמך לחתימה</span>
            </Link>
          </div>
        </div>
      </header>

      {/* The mobile drawer. Opens from the start edge (right, in RTL). */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="תפריט ניווט">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
              <span dir="ltr" className="text-base font-bold tracking-tight text-fg">
                XTRA SIGN
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="סגירת התפריט"
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-fg"
              >
                <X aria-hidden="true" className="size-5" strokeWidth={1.75} />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="ניווט ראשי">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`flex min-h-12 items-center rounded-lg px-4 text-base transition-colors hover:bg-slate-100 hover:text-fg ${
                    isActive(pathname, item.href) ? 'bg-slate-100 font-semibold text-fg' : 'text-fg'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="border-t border-line p-3">
              <Link
                href="/documents/new"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-12 items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition hover:opacity-90"
              >
                שלח מסמך לחתימה
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
