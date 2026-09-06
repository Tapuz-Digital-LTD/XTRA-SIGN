import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { selfServiceOf } from '@/server/projects/self-service'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { resolveSigningToken } from '@/server/signing/session'
import { CampaignFrame, CampaignNotice } from '../../CampaignFrame'
import { ThanksView } from '../../ThanksView'

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
export default async function ThanksPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolveSigningToken(token)
  if (!context) return <Expired />

  const origin = await selfServiceOriginOf(context.agreementId)
  if (origin?.skin.key !== 'tourism-2026') redirect(`/sign/${token}`)
  if (context.status !== 'signed') redirect(`/tourism-2026/sign/${token}`)

  const db = getDb()
  const [project] = await db
    .select({ name: schema.groups.name, landingConfig: schema.groups.landingConfig })
    .from(schema.groups)
    .where(eq(schema.groups.id, origin.projectId))
    .limit(1)
  const config = selfServiceOf(project?.landingConfig)

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
    <CampaignFrame title="ההצטרפות הושלמה">
      <ThanksView
        title={config.thankYouTitle}
        text={config.thankYouText}
        projectName={project?.name ?? 'חודש התיירות הישראלית 2026'}
        signerName={context.recipientName}
        downloadHref={`/api/sign/${token}/download`}
        emailed={Boolean(emailed)}
        email={context.recipientEmail}
      />
    </CampaignFrame>
  )
}

function Expired() {
  return (
    <CampaignFrame title="ההצטרפות הושלמה">
      <CampaignNotice
        title="תוקף הקישור הסתיים"
        text="ניתן לפנות לצוות הפרויקט לקבלת קישור חדש: tour@xtra.co.il"
      />
    </CampaignFrame>
  )
}
