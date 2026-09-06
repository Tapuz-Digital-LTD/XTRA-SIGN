import Link from 'next/link'
import { FloatingCta } from './FloatingCta'

/**
 * Page 1 — the call for suppliers.
 *
 * The Ministry's approved artwork (.design/tourism-2026/artwork.jpeg) is the
 * design. Every branded piece — logo, handwritten headlines, icons, the
 * character, the signpost — is a crop of it, placed at its own coordinates on
 * a 1600-unit canvas; the copy is real text in Heebo, so it is readable,
 * selectable and searchable. The navy field and the pink band are CSS, and
 * continue to the viewport edges on wide screens.
 *
 * Copy is written line by line as the artwork breaks it: on the canvas each
 * line is its own row, so the layout matches whatever the font's metrics do;
 * on a phone the lines flow into one paragraph.
 *
 * Under 860px the same pieces stack in reading order; the character and the
 * signpost keep their arrangement so the band stays seamless.
 */

const BODY = [
  'הקול הקורא פתוח לכל עסק תומך תיירות בישראל, ובכלל זה: לינה, אטרקציות, פנאי',
  'וקולינריה. הפעילות תתנהל במתכונת שבועית נודדת לאורך כל רחבי הארץ.',
]

const CONDITIONS = [
  { icon: 'icon-discount', lines: ['הנחה קבועה ורציפה לכל אורך חודש נובמבר', 'עבור הגולשים שנרשמים דרך האתר הרשמי.'] },
  { icon: 'icon-shop', lines: ['הנחה של מעל 25% ממחירון העסק הרגיל', 'בשבוע הממוקד של האזור שבו נמצא העסק שלכם.'] },
  { icon: 'icon-shield', lines: ['התחייבות לקיום כל האישורים, הרשיונות', 'והביטוחים בהתאם לחוק.'] },
]

const BENEFITS = [
  { icon: 'icon-people', lines: ['מילוי תפוסות, הגדלת מחזורי מכירות', 'ובניית קהל לקוחות נאמן לתקופת החורף.'] },
  { icon: 'icon-megaphone', lines: ['חיבור מקומי וחיזוק', 'לתיירות הפנים.'] },
  { icon: 'icon-laptop', lines: ['חשיפה ארצית באתר האירוע הרשמי, תוך קידום', 'ממומן של משרד התיירות והגעה למאות אלפי גולשים'] },
]

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
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const carried = new URLSearchParams()
  for (const key of UTM_KEYS) {
    const value = query[key]
    if (typeof value === 'string' && value.trim()) carried.set(key, value.trim().slice(0, 200))
  }
  const joinHref = carried.size > 0 ? `/tourism-2026/join?${carried}` : '/tourism-2026/join'

  return (
    <main className="tl-page">
      <div className="tl-canvas">
        <div className="tl-band" aria-hidden="true" />

        <img src="/tourism-2026/logo.webp" alt="משרד התיירות" className="tl-logo" width={380} height={134} fetchPriority="high" />

        <h1 className="tl-headline">
          <img
            src="/tourism-2026/headline.webp"
            alt="קול קורא לעסקי תיירות להצטרף לחודש התיירות הישראלית!"
            width={945}
            height={234}
            fetchPriority="high"
          />
        </h1>

        <p className="tl-body">
          <Lines lines={BODY} />
        </p>

        <h2 className="tl-title tl-title-conditions">
          <img src="/tourism-2026/title-conditions.webp" alt="תנאי הסף להשתתפות" width={450} height={80} />
        </h2>
        <p className="tl-sub">כדי להצטרף למיזם ולהופיע באתר הרשמי, על העסק לעמוד בתנאים הבאים:</p>
        <ul className="tl-list tl-conditions">
          {CONDITIONS.map((item) => (
            <li key={item.icon}>
              <img src={`/tourism-2026/${item.icon}.webp`} alt="" width={92} height={90} />
              <span>
                <Lines lines={item.lines} />
              </span>
            </li>
          ))}
        </ul>

        <h2 className="tl-title tl-title-benefits">
          <img src="/tourism-2026/title-benefits.webp" alt="מה העסק שלכם מרוויח?" width={490} height={75} />
        </h2>
        <ul className="tl-list tl-benefits">
          {BENEFITS.map((item) => (
            <li key={item.icon}>
              <img src={`/tourism-2026/${item.icon}.webp`} alt="" width={92} height={90} />
              <span>
                <Lines lines={item.lines} />
              </span>
            </li>
          ))}
        </ul>

        <p className="tl-closing-script">
          <img
            src="/tourism-2026/closing-script.webp"
            alt="ההרשמה בעיצומה והמקומות באתר המרכזי מוגבלים!"
            width={1015}
            height={80}
          />
        </p>
        <p className="tl-closing-bold">
          <img
            src="/tourism-2026/closing-bold.webp"
            alt="אל תפספסו את ההזדמנות להיות חלק מהאירוע התיירותי של השנה."
            width={850}
            height={121}
          />
        </p>

        <div className="tl-stage">
          <div className="tl-stage-band" aria-hidden="true" />
          <img src="/tourism-2026/character.webp" alt="" className="tl-character" width={600} height={1390} loading="lazy" />
          <Link href={joinHref} className="tl-cta" aria-label="מכאן מצטרפים — להצטרפות לחודש התיירות הישראלית">
            <img src="/tourism-2026/signpost.webp" alt="" width={420} height={260} />
          </Link>
          <Link href={joinHref} className="tl-cta-button">
            <span>מכאן מצטרפים</span>
            <span aria-hidden="true">←</span>
          </Link>
        </div>
      </div>
      <FloatingCta href={joinHref} watch=".tl-cta" />
    </main>
  )
}
