import Link from 'next/link'

/**
 * The frame around pages 2 and 3: the campaign's navy header carrying the
 * three marks the printed agreement carries — the Ministry, בנדה, and XTRA,
 * whose system this is — over a light reading surface, with none of the
 * XTRA Sign shell.
 *
 * The XTRA wordmark is red with a dark outline and would fight the navy, so
 * it sits on a small white chip, the way the sign-in page shows it.
 */
export function CampaignFrame({ children, title, slug }: { children: React.ReactNode; title: string; slug: string }) {
  return (
    <main className="tj-page">
      <header className="tj-header">
        <div className="tj-header-marks">
          <Link href={`/${slug}`} className="tj-header-logo" aria-label="לעמוד הקול הקורא">
            <img src="/tourism-2026/logo.webp" alt="משרד התיירות" width={190} height={67} />
          </Link>
          <img src="/tourism-2026/producer-logo.webp" alt="בנדה — חותם אישי בהפקות" width={216} height={112} className="tj-header-producer" />
        </div>
        <span className="tj-header-title">{title}</span>
        <span className="tj-header-xtra" title="מופעל באמצעות XTRA">
          <img src="/xtra-logo.png" alt="XTRA" width={2039} height={492} />
        </span>
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
