import type { Metadata } from 'next'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { CampaignFrame } from '../../CampaignFrame'
import { RenewSigning } from '../../RenewSigning'
import { campaignProject, type SearchParams } from '../../resolve'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'המשך חתימה', robots: { index: false, follow: false } }

/**
 * A stable address for one registration, with no secret in it: opening it
 * sends the phone code again and continues the same agreement. Safe to
 * bookmark, safe in an old message — access is renewed by the phone, not
 * by the link.
 */
export default async function ContinuePage({ params, searchParams }: { params: Promise<{ slug: string; registrationId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug, registrationId }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, `/continue/${registrationId}`, query)
  const [lead] = /^[0-9a-f-]{36}$/i.test(registrationId)
    ? await getDb().select({ id: schema.projectLeads.id }).from(schema.projectLeads).where(and(eq(schema.projectLeads.id, registrationId), eq(schema.projectLeads.groupId, project.groupId))).limit(1)
    : []
  return (
    <CampaignFrame slug={slug} title="המשך חתימה">
      {lead ? (
        <RenewSigning slug={slug} formId={project.formId} registrationId={lead.id} />
      ) : (
        <div className="tj-flow"><section className="tj-card tj-center"><h1 className="tj-h1">לא מצאנו את ההרשמה</h1><p className="tj-lead">אפשר להירשם מחדש מעמוד הקמפיין.</p></section></div>
      )}
    </CampaignFrame>
  )
}
