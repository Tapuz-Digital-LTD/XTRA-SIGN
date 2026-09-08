import { CampaignTracker } from './CampaignTracker'
import { CtaLink } from './CtaLink'
import { ClosedView } from './ClosedView'
import { skinByKey } from '@/lib/self-service-skins'
import { getSession } from '@/server/auth/session'
import { FloatingCta } from './FloatingCta'
import { campaignProject, type SearchParams } from './resolve'

export const dynamic = 'force-dynamic'

/**
 * Page 1 — the call for suppliers.
 *
 * The Ministry's approved artwork (.design/tourism-2026/artwork.jpeg) is the
 * design. Every branded piece — the landscape, the handwritten and display
 * headlines, the icons, the production company's mark, the signpost — is a
 * crop of it, placed at its own coordinates on a 1600-unit canvas; the copy
 * is real text in Heebo, so it is readable, selectable and searchable. The
 * navy field and the pink band are CSS, and continue to the viewport edges
 * on wide screens.
 *
 * Copy is written line by line as the artwork breaks it: on the canvas each
 * line is its own row, so the layout matches whatever the font's metrics do;
 * on a phone the lines flow into paragraphs.
 *
 * Two things the paper cannot do, the page does: the printed QR sends people
 * to a form of the Ministry's producer, and here it carries this campaign's
 * own address (public/tourism-2026/qr.svg); and the signpost is a link to
 * the joining page instead of an instruction to scan.
 *
 * Under 860px the same pieces stack in reading order, the landscape becomes
 * the header image, and the joining card grows a full-width button.
 */

/** The paragraph above the conditions, as the artwork breaks it. */
const LEDE = 'אנו מזמינים אתכם לקחת חלק במיזם בשנתו השנייה,'

const BODY = [
  'ארבעה שבועות של פעילות, בימים רביעי עד שבת, עם מאות',
  'פעילויות, מאות סיורים ואירועי עוגן מסובסדים ב־18 ₪ בלבד.',
]

const PUNCH = 'אל תפספסו את ההזדמנות להיות חלק מהמיזם המשמעותי!'

const SUB = 'כדי להצטרף למיזם ולהופיע באתר הרשמי, על העסק לעמוד בתנאים הבאים:'

const CONDITIONS = [
  { icon: 'icon-shop', lines: ['הנחה של מעל 25% ממחירון העסק הרגיל', 'בשבוע הממוקד של האזור שבו נמצא העסק שלכם.'] },
  { icon: 'icon-shield', lines: ['התחייבות לקיום כל האישורים, הרשיונות', 'והביטוחים בהתאם לחוק.'] },
]

const BENEFITS = [
  { icon: 'icon-laptop', lines: ['חשיפה ארצית באתר המיזם המקוון, תוך קידום', 'ממומן של משרד התיירות והגעה לאלפי גולשים'] },
  { icon: 'icon-megaphone', lines: ['חיבור מקומי וחיזוק', 'לתיירות הפנים.'] },
]

/** The white card at the foot of the artwork, beside the code. */
const JOIN = ['לתקנון המפורט ולפרטים נוספים', 'סירקו את הברקוד משמאל', 'או כנסו בלחיצה על הכפתור']
const DEADLINE = 'להצטרפות עד: 22 בספטמבר 2026'

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <span key={index} className="tl-line">
          {line}
          {index < lines.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/** Campaign attribution travels from the ad to the joining page on the link. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export default async function TourismCallPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, '', query)
  const preview = query.preview === 'ended' || query.preview === 'paused' ? (query.preview as 'ended' | 'paused') : null
  const closed = project.closed ?? (preview && (await getSession()) ? preview : null)
  if (closed) return <ClosedView slug={slug} state={closed} campaignName={project.projectName} message={project.endedMessage} logoSrc={`${skinByKey(project.config.skin)?.assetsPath ?? ''}/logo.webp`} website={project.orgWebsite} />
  const carried = new URLSearchParams()
  for (const key of UTM_KEYS) {
    const value = query[key]
    if (typeof value === 'string' && value.trim()) carried.set(key, value.trim().slice(0, 200))
  }
  const joinHref = carried.size > 0 ? `/${slug}/join?${carried}` : `/${slug}/join`

  return (
    <main className="tl-page">
      <div className="tl-canvas">
        <div className="tl-band" aria-hidden="true" />

        {/* On a phone the header is navy, so the logo comes in white. */}
        <img src="/tourism-2026/logo.webp" alt="משרד התיירות" className="tl-logo" width={380} height={134} />
        <img src="/tourism-2026/producer-logo.webp" alt="" className="tl-producer" width={216} height={112} />

        <p className="tl-kicker">
          <img src="/tourism-2026/headline-script.webp" alt="קול קורא לעסקי תיירות להצטרף למיזם" width={760} height={103} fetchPriority="high" />
        </p>
        <h1 className="tl-headline">
          <img src="/tourism-2026/headline-title.webp" alt="חודש התיירות הישראלית — נובמבר 2026" width={748} height={189} fetchPriority="high" />
        </h1>

        {/* The landscape. On the canvas it is the left half, with the
            Ministry's logo standing on its sky; on a phone it is a band under
            the headline, framed on the person, and the logo comes from the
            header above. It sits here in the source so a phone reads the
            campaign's name before it meets the picture. */}
        <img src="/tourism-2026/scene.webp" alt="" className="tl-scene" width={682} height={1600} fetchPriority="high" />

        <p className="tl-lede">{LEDE}</p>
        <p className="tl-body">
          <Lines lines={BODY} />
        </p>
        <p className="tl-punch">{PUNCH}</p>

        <h2 className="tl-title tl-title-conditions">
          <img src="/tourism-2026/title-conditions.webp" alt="תנאי הסף להשתתפות" width={405} height={86} />
        </h2>
        <p className="tl-sub">{SUB}</p>
        <ul className="tl-list tl-conditions">
          {CONDITIONS.map((item) => (
            <li key={item.icon}>
              <img src={`/tourism-2026/${item.icon}.webp`} alt="" width={64} height={63} />
              <span>
                <Lines lines={item.lines} />
              </span>
            </li>
          ))}
        </ul>

        <h2 className="tl-title tl-title-benefits">
          <img src="/tourism-2026/title-benefits.webp" alt="פוטנציאל – מה אתם מקבלים" width={526} height={99} />
        </h2>
        <ul className="tl-list tl-benefits">
          {BENEFITS.map((item) => (
            <li key={item.icon}>
              <img src={`/tourism-2026/${item.icon}.webp`} alt="" width={76} height={79} />
              <span>
                <Lines lines={item.lines} />
              </span>
            </li>
          ))}
        </ul>

        <p className="tl-closing">
          <img src="/tourism-2026/closing-script.webp" alt="ההרשמה בעיצומה והמקומות באתר המרכזי מוגבלים!" width={882} height={92} loading="lazy" />
        </p>

        <div className="tl-join">
          <div className="tl-join-card">
            <img src="/tourism-2026/qr.svg" alt="" className="tl-qr" width={128} height={128} loading="lazy" />
            <div className="tl-join-copy">
              <p className="tl-join-lines">
                <Lines lines={JOIN} />
              </p>
              <p className="tl-deadline">{DEADLINE}</p>
            </div>
          </div>
          <CtaLink formId={project.formId} href={joinHref} className="tl-cta" aria-label="מכאן מצטרפים — להרשמה ולחתימה על הסכם ההצטרפות">
            <img src="/tourism-2026/signpost.webp" alt="" width={269} height={205} />
            <span className="tl-cta-label" aria-hidden="true">
              מכאן מצטרפים
              <span className="tl-cta-arrow">←</span>
            </span>
          </CtaLink>
        </div>
      </div>
      <FloatingCta href={joinHref} watch=".tl-cta" formId={project.formId} />
      <CampaignTracker formId={project.formId} event="page_view" />
    </main>
  )
}
