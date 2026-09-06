import type { Metadata } from 'next'
import { findSelfServiceProjectBySkin } from '@/server/projects/self-service'
import { CampaignFrame, CampaignNotice } from '../CampaignFrame'
import { JoinAndSign } from '../JoinAndSign'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'הצטרפות וחתימה — חודש התיירות הישראלית 2026',
  robots: { index: false, follow: false },
}

/** Page 2, fresh: details, agreement, signature, code. */
export default async function JoinPage() {
  const project = await findSelfServiceProjectBySkin('tourism-2026')

  return (
    <CampaignFrame title="הצטרפות וחתימה">
      {project ? (
        <JoinAndSign mode="new" projectName={project.projectName} />
      ) : (
        <CampaignNotice title="ההרשמה אינה פעילה כרגע" text="אפשר לפנות לצוות הפרויקט בכתובת tour@xtra.co.il." />
      )}
    </CampaignFrame>
  )
}
