import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { maskPhone, toIsraeliNationalFormat } from '@/lib/phone'
import type { RegistrationValues } from '@/lib/self-service-registration'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { hasVerifiedSession, isSignable, resolveSigningToken } from '@/server/signing/session'
import { CampaignFrame, CampaignNotice } from '../../CampaignFrame'
import { JoinAndSign } from '../../JoinAndSign'

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
export default async function ResumeSigningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolveSigningToken(token)

  if (!context) return <Expired />

  const origin = await selfServiceOriginOf(context.agreementId)
  if (origin?.skin.key !== 'tourism-2026') redirect(`/sign/${token}`)

  if (context.status === 'signed') redirect(`/tourism-2026/thanks/${token}`)
  if (!isSignable(context.status)) return <Expired />

  const db = getDb()
  const [agreement] = await db
    .select({ mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, context.agreementId))
    .limit(1)
  const snapshot = (agreement?.mergeSnapshot as { values?: RegistrationValues } | null)?.values
  if (!snapshot) return <Expired />
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
  const [project] = await db
    .select({ name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.id, origin.projectId))
    .limit(1)

  return (
    <CampaignFrame title="המשך חתימה">
      <JoinAndSign
        mode="resume"
        projectName={project?.name ?? 'חודש התיירות הישראלית 2026'}
        token={token}
        values={values}
        verified={verified}
        maskedPhone={maskPhone(context.recipientPhone) ?? ''}
      />
    </CampaignFrame>
  )
}

function Expired() {
  return (
    <CampaignFrame title="הצטרפות וחתימה">
      <CampaignNotice
        title="תוקף הקישור הסתיים"
        text="ניתן לפנות לצוות הפרויקט לקבלת קישור חדש: tour@xtra.co.il"
      />
    </CampaignFrame>
  )
}
