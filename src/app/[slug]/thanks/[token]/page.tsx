import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { renewQuietly } from '@/server/signing/continue'
import { resolveSigningToken } from '@/server/signing/session'
import { RenewSigning } from '../../RenewSigning'
import { CampaignFrame } from '../../CampaignFrame'
import { CampaignTracker } from '../../CampaignTracker'
import { ThanksView } from '../../ThanksView'
import { campaignProject, type SearchParams } from '../../resolve'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'ההצטרפות הושלמה — חודש התיירות הישראלית 2026',
  robots: { index: false, follow: false },
}

/**
 * Page 3 — done.
 *
 * The signing token is the key: it is agreement-scoped, opaque and expiring,
 * and the download behind the button is the existing signer download (a
 * two-minute presigned URL). A token whose agreement is not signed yet goes
 * back to signing; an unknown or expired one gets the plain message.
 */
export default async function ThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ slug, token }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, `/thanks/${token}`, query)
  const context = await resolveSigningToken(token)
  if (!context) {
    // The link ran out after the signature: a verified browser gets a fresh
    // one quietly; anyone else asks for a code and lands back here.
    const quiet = await renewQuietly(token)
    if (quiet) redirect(quiet.path)
    return (
      <CampaignFrame slug={slug} title="ההצטרפות הושלמה">
        <RenewSigning slug={slug} formId={project.formId} token={token} />
      </CampaignFrame>
    )
  }

  const origin = await selfServiceOriginOf(context.agreementId)
  if (origin?.projectId !== project.groupId) redirect(`/sign/${token}`)
  if (context.status !== 'signed') redirect(`/${slug}/sign/${token}`)

  const db = getDb()
  const config = project.config

  // "A copy was emailed" only when one actually left.
  const [emailed] = await db
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.agreementId, context.agreementId),
        eq(schema.auditEvents.type, AUDIT_EVENTS.EMAIL_SENT),
        sql`${schema.auditEvents.metadata}->>'purpose' = 'signed_copy'`,
      ),
    )
    .limit(1)

  return (
    <CampaignFrame slug={slug} title="ההצטרפות הושלמה">
      <ThanksView
        title={config.thankYouTitle}
        text={config.thankYouText}
        projectName={project.projectName}
        signerName={context.recipientName}
        downloadHref={`/api/sign/${token}/download`}
        formId={project.formId}
        token={token}
        emailed={Boolean(emailed)}
        email={context.recipientEmail}
      />
      <CampaignTracker formId={project.formId} event="thank_you_viewed" token={token} />
    </CampaignFrame>
  )
}

