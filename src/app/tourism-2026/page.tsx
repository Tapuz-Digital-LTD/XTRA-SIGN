import type { Metadata } from 'next'
import { Heebo } from 'next/font/google'
import { getPublicLanding } from '@/server/projects/landing'
import { TOURISM_FORM_SLUG } from './config'
import { TourismForm } from './TourismForm'
import './tourism.css'

/**
 * שבוע התיירות 2026 — the Ministry of Tourism campaign landing page.
 *
 * A standalone public front: none of the XTRA Sign shell, styles or branding.
 * XTRA Sign is only the engine behind the form — submissions go through the
 * canonical public submission pipeline into the project's leads.
 *
 * The Ministry's approved reference artwork (862×1824) is the design spec;
 * the hero composition, campaign logo, handwritten slogan and bottom artwork
 * are the supplied brand assets, extracted from it.
 */

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-heebo',
  display: 'swap',
})

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'שבוע התיירות 2026 — מצטרפים ונהנים',
  description:
    'שבוע תיירות — מצטרפים ונהנים. עסקים מוזמנים לקחת חלק בשבוע התיירות בנובמבר 2026, ליהנות מחשיפה ארצית ולהצטרף ליוזמה שמקדמת את התיירות בישראל.',
}

function BenefitIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 66 66" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const BENEFITS = [
  {
    title: 'חיבור',
    text: 'לתיירות הישראלית\nולקהילה',
    icon: (
      <BenefitIcon>
        <path d="M33 58c10-11 19-19.6 19-30a19 19 0 1 0-38 0c0 10.4 9 19 19 30Z" />
        <circle cx="33" cy="27" r="7.5" />
      </BenefitIcon>
    ),
  },
  {
    title: 'קידום',
    text: 'ההטבה שלכם\nלאלפי לקוחות',
    icon: (
      <BenefitIcon>
        <path d="M36.5 9.5 57 30a6 6 0 0 1 0 8.5L38.5 57a6 6 0 0 1-8.5 0L9.5 36.5V15a5.5 5.5 0 0 1 5.5-5.5h21.5Z" />
        <circle cx="22" cy="22" r="4" />
        <path d="m30 44 14-14" />
        <circle cx="31.5" cy="31.5" r="3.2" />
        <circle cx="42.5" cy="42.5" r="3.2" />
      </BenefitIcon>
    ),
  },
  {
    title: 'חיזוק',
    text: 'הקשר עם\nהקהל הישראלי',
    icon: (
      <BenefitIcon>
        <circle cx="33" cy="20" r="7" />
        <circle cx="17" cy="24" r="5.5" />
        <circle cx="49" cy="24" r="5.5" />
        <path d="M20 52v-5a13 13 0 0 1 26 0v5" />
        <path d="M8 47v-3.5a9 9 0 0 1 9-9M58 47v-3.5a9 9 0 0 0-9-9" />
      </BenefitIcon>
    ),
  },
  {
    title: 'חשיפה',
    text: 'בפלטפורמות\nהמובילות',
    icon: (
      <BenefitIcon>
        <path d="M40 14 16 26h-5a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h5l24 12V14Z" />
        <path d="M16 40v10a4 4 0 0 0 4 4h3V41M47 26l8-5M47 33h10M47 40l8 5" />
      </BenefitIcon>
    ),
  },
]

export default async function TourismLandingPage() {
  const landing = await getPublicLanding(TOURISM_FORM_SLUG)

  const benefitField = landing?.config.fields.find((f) => f.id === 'custom_benefit_type')
  const benefitOptions = benefitField?.options?.length ? benefitField.options : ['25%']

  return (
    <div className={`tl-page ${heebo.variable}`}>
      <main className="tl-root">
        <header className="tl-hero">
          <img
            src="/tourism-2026/hero-bg.webp"
            alt=""
            className="tl-hero-bg"
            fetchPriority="high"
          />
          {/* Mobile-only brand assets; on desktop they are part of the hero artwork. */}
          <img src="/tourism-2026/logo.webp" alt="חודש התיירות הישראלי — משרד התיירות" className="tl-hero-logo" />
          <h1 className="tl-hero-text tl-hero-title">
            <span className="tl-title-l1">
              {'שבוע תיירות'}
              <span className="tl-title-dash">-</span>
            </span>
            <br />
            <span className="tl-title-l2">מצטרפים ונהנים</span>
          </h1>
          <p className="tl-hero-text tl-hero-date">בנובמבר 2026</p>
          <img src="/tourism-2026/slogan.webp" alt="שמח מלא בתיירות ישראלית" className="tl-hero-slogan" />
          <p className="tl-hero-text tl-hero-copy">
            מוזמנים לקחת חלק בשבוע התיירות
            <br />
            וליהנות מחשיפה ארצית והזדמנות להשתתף
            <br />
            ביוזמה שמקדמת את התיירות בישראל!
          </p>
          <div className="tl-hero-photos">
            <img src="/tourism-2026/photo-hotel.webp" alt="" />
            <img src="/tourism-2026/photo-village.webp" alt="" />
            <img src="/tourism-2026/photo-museum.webp" alt="" />
            <img src="/tourism-2026/photo-nature.webp" alt="" />
          </div>
        </header>

        <div className="tl-band">
          <section className="tl-benefits" aria-labelledby="tl-benefits-heading">
            <h2 id="tl-benefits-heading" className="tl-benefits-heading">
              בואו להיות חלק מהחגיגה!
            </h2>
            <ul className="tl-benefits-grid" role="list" style={{ listStyle: 'none', margin: 0 }}>
              {BENEFITS.map((b) => (
                <li key={b.title} className="tl-benefit">
                  <div className="tl-benefit-icon">{b.icon}</div>
                  <h3 className="tl-benefit-title">{b.title}</h3>
                  <p className="tl-benefit-text">
                    {b.text.split('\n').map((line, i) => (
                      <span key={line}>
                        {i > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <TourismForm
            formAvailable={Boolean(landing)}
            benefitOptions={benefitOptions}
            hasAgreement={Boolean(landing?.config.agreementFileKey)}
            successMessage={landing?.config.successMessage ?? null}
          />
        </div>

        <img src="/tourism-2026/artwork.webp" alt="" className="tl-artwork" />
      </main>
    </div>
  )
}
