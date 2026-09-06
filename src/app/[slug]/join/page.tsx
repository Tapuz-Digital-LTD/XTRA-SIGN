import type { Metadata } from 'next'
import { CampaignFrame, CampaignNotice } from '../CampaignFrame'
import { REGISTRATIONS_CLOSED_MESSAGE } from '@/lib/campaigns'
import { CampaignTracker } from '../CampaignTracker'
import { JoinAndSign } from '../JoinAndSign'
import { campaignProject, type SearchParams } from '../resolve'
import { CAPTCHA_ACTIONS } from '@/lib/captcha'
import { captchaPublicConfig } from '@/server/security/captcha'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'הצטרפות וחתימה — חודש התיירות הישראלית 2026',
  robots: { index: false, follow: false },
}

/** Page 2, fresh: details, agreement, signature, code. */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, '/join', query)

  if (!project.registrationsOpen) {
    return (
      <CampaignFrame slug={slug} title="הצטרפות וחתימה">
        <CampaignNotice slug={slug} title={REGISTRATIONS_CLOSED_MESSAGE} text="תודה על ההתעניינות. הסכמים שכבר נוצרו ממשיכים להיות תקפים לפי הקישור שנשלח." />
      </CampaignFrame>
    )
  }

  return (
    <CampaignFrame slug={slug} title="הצטרפות וחתימה">
      <JoinAndSign mode="new" slug={slug} formId={project.formId} projectName={project.projectName} captcha={await captchaPublicConfig(CAPTCHA_ACTIONS.CAMPAIGN_REGISTRATION)} />
      <CampaignTracker formId={project.formId} event="page_view" />
    </CampaignFrame>
  )
}
