import { CampaignTracker } from './CampaignTracker'
import { CtaLink } from './CtaLink'
import { FloatingCta } from './FloatingCta'

/**
 * Page 1 for the hotels — the same call, in the ad the hotels received
 * (.design/tourism-2026-hotel, "מודעה קליקבילית-1.pdf").
 *
 * Reached with `?hotel=true` on the campaign's address; the personal link
 * of an invitation sent as "מלונות" carries it (self-service-skins.ts). It
 * changes only what the reader sees: the button goes to the same joining
 * form, on the same address, and the form knows nothing about it.
 *
 * The ad's top — terrace, bay, the three marks, the headline in its own
 * faces and the discount badge — is one picture, since none of that type
 * has a font. Everything under it is real text: the invitation, the four
 * regional weeks with the ad's own photographs, the hotel packages, the
 * four kinds of exposure, the contact line and the button. On a phone the
 * picture is cropped to the headline and the badge is drawn again in CSS,
 * where the crop cannot reach it.
 */

const INTRO = [
  'אנו מזמינים אתכם לקחת חלק במיזם השנה השנייה.',
  '3 אירועי עוגן בימי שישי בירושלים, בטבריה ובאשקלון – עם אומנים מובילים.',
  '1,000 סיורים מודרכים ברחבי הארץ, מאות אטרקציות וחוויות – לפי אזורים.',
]

/** The four weeks as the ad lists them — its own regions, its own colours. */
const WEEKS = [
  { image: 'week-1', color: '#7b2fb5', title: 'שבוע ראשון – ירושלים רבתי', dates: '4–7/11', regions: 'ירושלים, מטה יהודה, עמק המעיינות, בקעת הירדן, צפון ים המלח, מטה בנימין, יהודה ושומרון' },
  { image: 'week-2', color: '#009d48', title: 'שבוע שני – צפון', dates: '11–14/11', regions: 'חיפה, זבולון, גליל תחתון, עמק הירדן, רמת הגולן, גליל עליון, גליל מערבי' },
  { image: 'week-3', color: '#f26b21', title: 'שבוע שלישי – דרום', dates: '18–21/11', regions: 'באר שבע, אשקלון, עוטף, ים המלח, נגב, והערבה' },
  { image: 'week-4', color: '#2170e8', title: 'שבוע רביעי – תל אביב', dates: '25–28/11', regions: 'חוף הכרמל, עמק יזרעאל, הגלבוע, לכיש, שפיר, כולל תל אביב וגוש דן' },
]

const PACKAGES = ['אירועים וסבסוד לחבילות מלון כולל לינה', 'וכרטיסי כניסה לאטרקציות ב־18 שקלים']

const BENEFITS = [
  { image: 'benefit-site', title: 'אתר ייעודי', text: 'חשיפה באתר משרד התיירות' },
  { image: 'benefit-press', title: 'יח״צ', text: 'סיקור תקשורתי נרחב' },
  { image: 'benefit-social', title: 'סושיאל ודיגיטל', text: 'חשיפה רחבה, קידום וחיפוש' },
  { image: 'benefit-campaign', title: 'קמפיין ארצי', text: 'קמפיין פרסום מוקד בכל הארץ' },
]

const CONTACT = { name: 'יהודית', phone: '050-5323298', whatsapp: 'https://wa.me/972505323298' }

const HERO_ALT = 'הצטרפו למיזם הלאומי: חודש התיירות הישראלית, נובמבר 2026, שנה שנייה ברציפות. החל מ־25% הנחה למשך שבוע בלבד. משרד התיירות, התאחדות המלונות בישראל, בנדה הפקות.'

export function HotelCall({ formId, joinHref }: { formId: string; joinHref: string }) {
  return (
    <main className="tl-page th-page">
      <header className="th-hero">
        <h1 className="th-hero-media">
          <img src="/tourism-2026/hotel/hero.webp" alt={HERO_ALT} width={1676} height={926} fetchPriority="high" />
        </h1>
        {/* The badge is in the picture; a phone's crop loses it, so it is drawn again there. */}
        <p className="th-badge" aria-hidden="true">
          <span>החל מ־</span>
          <strong>25%</strong>
          <span>הנחה</span>
          <small>למשך שבוע בלבד</small>
        </p>
      </header>

      <div className="th-body">
        <section className="th-intro" aria-label="ההזמנה">
          {INTRO.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>

        <section aria-label="ארבעת השבועות האזוריים">
          <ol className="th-weeks">
            {WEEKS.map((week) => (
              <li key={week.image} className="th-week">
                <img src={`/tourism-2026/hotel/${week.image}.webp`} alt="" width={339} height={307} loading="lazy" />
                <h2 style={{ color: week.color }}>{week.title}</h2>
                <p className="th-dates" style={{ color: week.color }} dir="ltr">
                  {week.dates}
                </p>
                <p className="th-regions">{week.regions}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className="th-packages">
          {PACKAGES.map((line, index) => (
            <span key={line} className="th-line">
              {line}
              {index < PACKAGES.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>

        <section aria-label="מה אתם מקבלים">
          <ul className="th-benefits">
            {BENEFITS.map((item) => (
              <li key={item.image} className="th-benefit">
                <img src={`/tourism-2026/hotel/${item.image}.webp`} alt="" width={126} height={126} loading="lazy" />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="th-contact">
          <span>לפרטים והצטרפות לשת״פ | {CONTACT.name}:</span>
          <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp אל ${CONTACT.name}, ${CONTACT.phone}`}>
            <span dir="ltr">{CONTACT.phone}</span>
            <img src="/tourism-2026/hotel/whatsapp.webp" alt="" width={76} height={75} loading="lazy" />
          </a>
        </p>

        <div className="th-join">
          <CtaLink formId={formId} href={joinHref} className="th-cta" aria-label="לחץ כאן — להרשמה ולחתימה על הסכם ההצטרפות">
            לחץ כאן
            <span className="th-cta-arrow" aria-hidden="true">
              ‹
            </span>
          </CtaLink>
        </div>
      </div>

      <img src="/tourism-2026/hotel/foot.webp" alt="" className="th-foot" width={1676} height={250} loading="lazy" />

      <FloatingCta href={joinHref} watch=".th-cta" formId={formId} />
      <CampaignTracker formId={formId} event="page_view" />
    </main>
  )
}
