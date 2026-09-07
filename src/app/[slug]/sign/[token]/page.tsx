import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { maskPhone, toIsraeliNationalFormat } from '@/lib/phone'
import type { RegistrationValues } from '@/lib/self-service-registration'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { renewQuietly } from '@/server/signing/continue'
import { hasVerifiedSession, isSignable, resolveSigningToken } from '@/server/signing/session'
import { CampaignFrame } from '../../CampaignFrame'
import { ClosedView } from '../../ClosedView'
import { RenewSigning } from '../../RenewSigning'
import { skinByKey } from '@/lib/self-service-skins'
import { JoinAndSign } from '../../JoinAndSign'
import { campaignProject, type SearchParams } from '../../resolve'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'המשך חתימה — חודש התיירות הישראלית 2026',
  robots: { index: false, follow: false },
}

/**
 * Page 2, resumed from the SMS or the email: the same page with the details
 * already locked in, and the signature and the code still to do. Signed →
 * the thank-you page; expired, cancelled or unknown → one plain message.
 */
export default async function ResumeSigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ slug, token }, query] = await Promise.all([params, searchParams])
  const project = await campaignProject(slug, `/sign/${token}`, query)
  const context = await resolveSigningToken(token)

  if (!context) {
    // The permission behind the link ran out; the browser that already proved
    // the phone gets a fresh one with no screen in between.
    const quiet = await renewQuietly(token)
    if (quiet) redirect(quiet.path)
    return <Renew slug={slug} formId={project.formId} token={token} />
  }
  if (!project.completionAllowed && context.status !== 'signed') {
    return <ClosedView slug={slug} state={project.closed ?? 'ended'} campaignName={project.projectName} message={project.endedMessage} logoSrc={`${skinByKey(project.config.skin)?.assetsPath ?? ''}/logo.webp`} website={project.orgWebsite} />
  }

  // A link that belongs to another project's agreement is sent through the
  // engine's own door, which knows where it lives.
  const origin = await selfServiceOriginOf(context.agreementId)
  if (origin?.projectId !== project.groupId) redirect(`/sign/${token}`)

  if (context.status === 'signed') redirect(`/${slug}/thanks/${token}`)
  if (!isSignable(context.status)) return <Renew slug={slug} formId={project.formId} token={token} />

  const db = getDb()
  const [agreement] = await db
    .select({ mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, context.agreementId))
    .limit(1)
  const snapshot = (agreement?.mergeSnapshot as { values?: RegistrationValues } | null)?.values
  if (!snapshot) return <Renew slug={slug} formId={project.formId} token={token} />
  // Shown, not edited: the phone reads as a person writes it, not as E.164.
  const national = toIsraeliNationalFormat(snapshot.phone)
  const values: RegistrationValues = { ...snapshot, phone: national ? `${national.slice(0, 3)}-${national.slice(3)}` : snapshot.phone }

  // First open marks the document as viewed, as the standard signer page does.
  if (context.status === 'sent') {
    await db.update(schema.agreements).set({ status: 'viewed' }).where(eq(schema.agreements.id, context.agreementId))
    await db.insert(schema.auditEvents).values({
      agreementId: context.agreementId,
      recipientId: context.recipientId,
      type: AUDIT_EVENTS.VIEWED,
      actor: 'signer',
    })
  }

  const verified = await hasVerifiedSession(context)

  return (
    <CampaignFrame slug={slug} title="המשך חתימה">
      <JoinAndSign
        mode="resume"
        slug={slug}
        formId={project.formId}
        projectName={project.projectName}
        token={token}
        values={values}
        verified={verified}
        maskedPhone={maskPhone(context.recipientPhone) ?? ''}
      />
    </CampaignFrame>
  )
}

function Renew({ slug, formId, token }: { slug: string; formId: string; token: string }) {
  return (
    <CampaignFrame slug={slug} title="המשך חתימה">
      <RenewSigning slug={slug} formId={formId} token={token} />
    </CampaignFrame>
  )
}
