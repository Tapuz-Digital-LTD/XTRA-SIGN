import type { Metadata } from 'next'
import { TOURISM_WEEKS } from '@/lib/self-service-registration'
import { skinByKey } from '@/lib/self-service-skins'
import { CampaignFrame } from '../CampaignFrame'
import { CampaignTracker } from '../CampaignTracker'
import { ClosedView } from '../ClosedView'
import { CtaLink } from '../CtaLink'
import { FloatingCta } from '../FloatingCta'
import { campaignProject, carriedHref, type SearchParams } from '../resolve'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'על המיזם — חודש התיירות הישראלית 2026',
  robots: { index: false, follow: false },
}

/**
 * The page between the call and the form: what the project is, before a
 * business is asked to fill in anything.
 *
 * The words are the Ministry's, from the page it wrote for this (a document
 * called "בעמוד הראשון"), set for a screen: the story of the month, the four
 * regional weeks, why to join, the main terms, who to call, and one button
 * on to the agreement. Information only — no field, no consent lives here.
 * Both versions of the call (the regular one and the hotels') arrive here,
 * and the link on to the form carries whatever arrived on this address: the
 * personal invitation and the campaign tags above all.
 *
 * The weeks are listed as the agreement lists them (TOURISM_WEEKS), since
 * that is what a business commits to on the next page; the Ministry's
 * document names the regions in other words, which the owner is deciding on.
 */

const WHAT = [
  'חודש התיירות הישראלית הוא מיזם לאומי של משרד התיירות, בהפקת חברת בנדה הפקות, שמטרתו לחשוף את הציבור בישראל למגוון רחב של חוויות תיירות, תרבות, מורשת, קולינריה ופנאי בכל רחבי הארץ, במחירים מיוחדים ובאווירה חגיגית.',
  'המיזם נועד לחזק את היכרות הציבור הישראלי עם העושר התרבותי, ההיסטורי והנופי של ישראל, לעודד תיירות פנים ולתמוך בעסקי התיירות המקומיים ברחבי הארץ. הוא יתקיים לאורך ארבעה שבועות במהלך חודש נובמבר 2026, ובכל שבוע יעמוד במרכז אזור אחר בארץ.',
  // The 18 ₪ price is the subsidised tours' and anchor events'; the attractions and experiences are at special prices of their own.
  'במהלך החודש ייהנה הציבור ממאות אטרקציות, פעילויות וחוויות תיירותיות במחירים מיוחדים, ולצדן כ־1,000 סיורים ואירועי עוגן ברחבי הארץ במחיר מסובסד של 18 ₪ בלבד.',
  'אנו מזמינים אתכם, בעלי אטרקציות, עסקים תיירותיים, מוזיאונים, אתרי מורשת, שמורות טבע, מסעדות, יקבים, מקומות לינה, מרכזי מבקרים ועסקים המציעים חוויות ופעילויות לקהל הרחב, לקחת חלק בחודש התיירות הישראלית 2026.',
]

const WHY = [
  'חשיפה רחבה לקהלים מכל רחבי הארץ.',
  'הזדמנות להרחיב את מעגל הלקוחות ולהגדיל את היקף הפעילות העסקית.',
  'פרסום באתר המיזם.',
  'השתתפות במיזם לאומי רחב היקף שיזכה לחשיפה במסגרת קמפיין ארצי.',
  'תרומה לחיזוק התיירות והעסקים המקומיים בישראל.',
]

const TERMS = [
  'מתן הנחה של 25% לפחות ממחירון העסק המפורסם באתר המקוון של העסק, במהלך ימי הפעילות שבהם מתקיים המיזם באזורכם.',
  'החזקת כל האישורים, הרישיונות והביטוחים הנדרשים על פי דין ובהתאם לאופי הפעילות.',
  'התחייבות למתן שירות איכותי ולעמידה בכללי המיזם ובתנאיו.',
]

const CLOSING = 'נשמח לראותכם שותפים במיזם חשוב זה, ויחד לקדם את התיירות הישראלית, לחזק את העסקים המקומיים ולחשוף את פעילותכם לקהלים חדשים מכל רחבי הארץ.'

const CONTACT = { name: 'יהודית', phone: '050-5323298', tel: 'tel:+972505323298', whatsapp: 'https://wa.me/972505323298' }

export default async function AboutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, '/about', query)
  if (project.closed) {
    return <ClosedView slug={slug} state={project.closed} campaignName={project.projectName} message={project.endedMessage} logoSrc={`${skinByKey(project.config.skin)?.assetsPath ?? ''}/logo.webp`} website={project.orgWebsite} />
  }
  const joinHref = carriedHref(slug, 'join', query)

  return (
    <CampaignFrame slug={slug} title="על המיזם">
      <div className="tj-flow">
        <section className="tj-intro">
          <h1 className="tj-h1">{project.projectName}</h1>
          <p className="tj-lead">מיזם לאומי של משרד התיירות, בהפקת בנדה הפקות. לפני ההסכם — מה המיזם, מתי הוא מתקיים, ומה הוא מבקש מבית העסק.</p>
        </section>

        <section className="tj-card" aria-labelledby="ta-what">
          <h2 id="ta-what" className="tj-h2">מהו המיזם</h2>
          {WHAT.map((text) => (
            <p key={text} className="tj-clause tj-about-p">
              {text}
            </p>
          ))}
        </section>

        <section className="tj-card" aria-labelledby="ta-weeks">
          <h2 id="ta-weeks" className="tj-h2">ארבעת השבועות והאזורים</h2>
          <p className="tj-clause tj-clause-lead">הפעילויות מתקיימות בימים רביעי עד שבת. בכל שבוע עומד במרכז אזור אחר בארץ, ובית העסק מתחייב להטבה בשבוע של האזור שלו.</p>
          <ol className="tj-about-weeks">
            {TOURISM_WEEKS.map((week) => (
              <li key={week.id} className="tj-about-week">
                <span className="tj-week-title">{week.title}</span>
                <span className="tj-week-dates" dir="ltr">
                  {week.dates}
                </span>
                <span className="tj-week-regions">{week.regions}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="tj-card" aria-labelledby="ta-why">
          <h2 id="ta-why" className="tj-h2">למה כדאי להצטרף</h2>
          <ul className="tj-terms">
            {WHY.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>

        <section className="tj-card" aria-labelledby="ta-terms">
          <h2 id="ta-terms" className="tj-h2">תנאי ההצטרפות העיקריים</h2>
          <ul className="tj-terms">
            {TERMS.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p className="tj-hint tj-hint-block">הנוסח המלא והמחייב הוא ההסכם שממלאים וחותמים בעמוד הבא.</p>
        </section>

        <section className="tj-card tj-about-cta" aria-labelledby="ta-join">
          <h2 id="ta-join" className="tj-h2">הצטרפות</h2>
          <p className="tj-clause tj-clause-lead">{CLOSING}</p>
          <p className="tj-about-contact">
            לשאלות אפשר לפנות ל{CONTACT.name}:{' '}
            <a href={CONTACT.tel} dir="ltr">
              {CONTACT.phone}
            </a>
            {' · '}
            <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </p>
          <CtaLink formId={project.formId} href={joinHref} className="tj-primary tj-primary-main tj-about-button">
            מעבר למילוי וחתימה על ההסכם
          </CtaLink>
        </section>
      </div>
      <FloatingCta href={joinHref} watch=".tj-about-button" formId={project.formId} label="למילוי וחתימה" />
      <CampaignTracker formId={project.formId} event="page_view" />
    </CampaignFrame>
  )
}
