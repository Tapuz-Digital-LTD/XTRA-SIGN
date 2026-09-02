import Image from 'next/image'
import Link from 'next/link'

/**
 * The primary spaces. Suppliers and customers are kept apart on purpose — a
 * document is reached through the company it concerns, not from one flat list.
 */
const NAV = [
  { href: '/suppliers', label: 'ספקים' },
  { href: '/customers', label: 'לקוחות' },
  { href: '/templates', label: 'תבניות' },
  { href: '/settings', label: 'הגדרות' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
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
              href="/suppliers"
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
                  className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-slate-100 hover:text-fg"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <Link
              href="/documents/new"
              className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              <span aria-hidden="true" className="me-1">
                +
              </span>
              מסמך חדש
            </Link>
          </div>

          {/* Mobile nav: its own row, so every target keeps its full height. */}
          <nav className="flex gap-1 pb-2 sm:hidden" aria-label="ניווט ראשי">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-slate-100 hover:text-fg"
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
