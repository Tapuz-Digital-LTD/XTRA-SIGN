import type { Metadata } from 'next'
import { CampaignFrame } from '../CampaignFrame'
import { ClosedView } from '../ClosedView'
import { skinByKey } from '@/lib/self-service-skins'
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

  if (project.closed) {
    return <ClosedView slug={slug} state={project.closed} campaignName={project.projectName} message={project.endedMessage} logoSrc={`${skinByKey(project.config.skin)?.assetsPath ?? ''}/logo.webp`} website={project.orgWebsite} />
  }

  return (
    <CampaignFrame slug={slug} title="הצטרפות וחתימה">
      <JoinAndSign mode="new" slug={slug} formId={project.formId} projectName={project.projectName} captcha={await captchaPublicConfig(CAPTCHA_ACTIONS.CAMPAIGN_REGISTRATION)} />
      <CampaignTracker formId={project.formId} event="page_view" />
    </CampaignFrame>
  )
}
