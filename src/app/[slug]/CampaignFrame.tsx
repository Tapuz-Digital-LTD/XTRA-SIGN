import Link from 'next/link'

/**
 * The frame around pages 2 and 3: the campaign's navy header with the
 * Ministry's logo, a light reading surface, no XTRA Sign chrome.
 */
export function CampaignFrame({ children, title, slug }: { children: React.ReactNode; title: string; slug: string }) {
  return (
    <main className="tj-page">
      <header className="tj-header">
        <Link href={`/${slug}`} className="tj-header-logo" aria-label="לעמוד הקול הקורא">
          <img src="/tourism-2026/logo.webp" alt="משרד התיירות" width={190} height={67} />
        </Link>
        <span className="tj-header-title">{title}</span>
      </header>
      <div className="tj-content">{children}</div>
      <footer className="tj-footer">
        <span className="tj-footer-band" aria-hidden="true" />
      </footer>
    </main>
  )
}

export function CampaignNotice({ title, text, slug }: { title: string; text: string; slug: string }) {
  return (
    <div className="tj-flow">
      <section className="tj-card tj-center">
        <p className="tj-big-info" aria-hidden="true">
          ⓘ
        </p>
        <h1 className="tj-h1">{title}</h1>
        <p className="tj-lead">{text}</p>
        <Link href={`/${slug}`} className="tj-secondary tj-inline-link">
          לעמוד הקול הקורא
        </Link>
      </section>
    </div>
  )
}
