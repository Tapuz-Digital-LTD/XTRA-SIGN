import Link from 'next/link'
import { DEFAULT_ENDED_TEXT, DEFAULT_PAUSED_TEXT, REGISTRATIONS_CLOSED_MESSAGE, REGISTRATIONS_PAUSED_MESSAGE } from '@/lib/campaigns'
import { CampaignFrame } from './CampaignFrame'

/**
 * The page a closed campaign shows in place of its form: the campaign's
 * own logo and name, the message the team wrote (or the plain default), and
 * a way back to the organization's site when one is set. Same address,
 * never a 404 — a link in an old flyer still lands somewhere kind.
 */
export function ClosedView({
  slug,
  state,
  campaignName,
  message,
  logoSrc,
  website,
}: {
  slug: string
  state: 'paused' | 'ended'
  campaignName: string
  message: string | null
  logoSrc: string | null
  website: string | null
}) {
  const title = state === 'paused' ? REGISTRATIONS_PAUSED_MESSAGE : REGISTRATIONS_CLOSED_MESSAGE
  const text = message?.trim() || (state === 'paused' ? DEFAULT_PAUSED_TEXT : DEFAULT_ENDED_TEXT)
  return (
    <CampaignFrame slug={slug} title={title}>
      <div className="tj-flow">
        <section className="tj-card tj-center" style={{ paddingBlock: 'clamp(2rem, 6vw, 3.5rem)' }}>
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" style={{ height: 'clamp(56px, 12vw, 88px)', width: 'auto', marginInline: 'auto', marginBottom: '1.25rem' }} />
          ) : null}
          <p className="tj-eyebrow" style={{ marginBottom: '.5rem', opacity: 0.8 }}>{campaignName}</p>
          <h1 className="tj-h1" style={{ fontSize: 'clamp(1.6rem, 5vw, 2.4rem)' }}>{title}</h1>
          <p className="tj-lead" style={{ maxWidth: '36rem', marginInline: 'auto', fontSize: 'clamp(1.05rem, 2.6vw, 1.25rem)', lineHeight: 1.6 }}>{text}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '.75rem', marginTop: '1.5rem' }}>
            {website ? (
              <a href={website} className="tj-primary tj-inline-link" style={{ minHeight: 52, fontSize: '1.05rem' }}>
                חזרה לאתר
              </a>
            ) : null}
            <Link href={`/${slug}`} className="tj-secondary tj-inline-link" style={{ minHeight: 52, fontSize: '1.05rem' }}>
              לעמוד הקמפיין
            </Link>
          </div>
        </section>
      </div>
    </CampaignFrame>
  )
}
