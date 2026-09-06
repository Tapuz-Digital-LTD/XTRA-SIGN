import type { Metadata } from 'next'
import { CampaignFrame } from '../CampaignFrame'
import { CampaignTracker } from '../CampaignTracker'
import { JoinAndSign } from '../JoinAndSign'
import { campaignProject, type SearchParams } from '../resolve'

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

  return (
    <CampaignFrame slug={slug} title="הצטרפות וחתימה">
      <JoinAndSign mode="new" slug={slug} formId={project.formId} projectName={project.projectName} />
      <CampaignTracker formId={project.formId} event="page_view" />
    </CampaignFrame>
  )
}
