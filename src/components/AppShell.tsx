import Image from 'next/image'
import Link from 'next/link'

/** Three nav items. Anything more is a category we have not earned yet. */
const NAV = [
  { href: '/documents', label: 'מסמכים' },
  { href: '/templates', label: 'תבניות' },
  { href: '/settings', label: 'הגדרות' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      {/*
        Two rows on mobile, one on desktop. Squeezing the logo, three nav items
        and the CTA onto a 375px line wrapped the CTA onto two lines and left
        the nav links 36px tall — under the 44px touch minimum.
      */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3 sm:justify-start">
            <Link
              href="/documents"
              className="inline-flex min-h-11 shrink-0 items-baseline gap-1.5"
              aria-label="XTRA SIGN — דף הבית"
            >
              {/* The wordmark is Latin, so it needs its own direction island:
                  inside dir="rtl" its parts lay out right-to-left and read as
                  "Sign XTRA". */}
              <span dir="ltr" className="inline-flex items-baseline gap-1.5">
                <Image
                  src="/xtra-logo.png"
                  alt="XTRA"
                  width={2039}
                  height={492}
                  priority
                  className="h-5 w-auto self-center"
                />
                <span className="text-lg font-bold tracking-tight text-fg">
                  SIGN
                </span>
              </span>
            </Link>

            <nav
              className="hidden flex-1 gap-1 sm:flex"
              aria-label="ניווט ראשי"
            >
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
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-slate-100 hover:text-fg"
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
