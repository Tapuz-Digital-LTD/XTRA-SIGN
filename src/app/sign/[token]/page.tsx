import { redirect } from 'next/navigation'
import { ContinueSigning } from '@/components/signer/ContinueSigning'
import { SignerFlow } from '@/components/signer/SignerFlow'
import { AUDIT_EVENTS } from '@/server/audit'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { getDb, schema } from '@/server/db'
import { loadFields, loadPageGeometry } from '@/server/documents/save-fields'
import { describeExpired, renewQuietly } from '@/server/signing/continue'
import { hasVerifiedSession, isSignable, resolveSigningToken } from '@/server/signing/session'
import { maskPhone } from '@/lib/phone'
import { eq } from 'drizzle-orm'

/**
 * The signer's page. No account, no password, no registration.
 *
 * Rendered fresh on every request: the link is not one-time-use, so reopening
 * it must land the signer wherever they actually are in the flow.
 */
export const dynamic = 'force-dynamic'

export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ continue?: string }> }) {
  const [{ token }, query] = await Promise.all([params, searchParams])
  const context = await resolveSigningToken(token)

  if (!context) {
    // The permission behind the link ran out. A browser that already proved
    // the phone continues with no screen; anyone else gets one button that
    // sends the code again. Unknown and revoked links get one plain page —
    // distinguishing them would tell someone guessing tokens which ones exist.
    const quiet = await renewQuietly(token)
    if (quiet) redirect(quiet.path)
    const expired = await describeExpired(token)
    if (!expired || expired.closed) return <LinkUnavailable closed={Boolean(expired?.closed)} />
    return <ContinueSigning token={token} maskedPhone={expired.maskedPhone} title={expired.title} signed={expired.signed} />
  }

  // A self-service agreement has its own branded pages (ADR 0001); the link
  // in the campaign's SMS lands here and continues there.
  const origin = await selfServiceOriginOf(context.agreementId)
  if (origin) redirect(`/${origin.slug}/sign/${token}`)

  const verified = await hasVerifiedSession(context)

  if (!isSignable(context.status)) {
    return <AlreadyDone title={context.title} status={context.status} token={token} />
  }

  const db = getDb()

  // First open marks the document as viewed; later opens do not re-fire it.
  if (context.status === 'sent') {
    await db
      .update(schema.agreements)
      .set({ status: 'viewed' })
      .where(eq(schema.agreements.id, context.agreementId))
    await db.insert(schema.auditEvents).values({
      agreementId: context.agreementId,
      recipientId: context.recipientId,
      type: AUDIT_EVENTS.VIEWED,
      actor: 'signer',
    })
  }

  const [pages, fields] = await Promise.all([
    loadPageGeometry(context.versionId),
    loadFields(context.versionId),
  ])

  return (
    <SignerFlow
      token={token}
      title={context.title}
      signerName={context.recipientName}
      maskedPhone={maskPhone(context.recipientPhone)}
      hasPhone={Boolean(context.recipientPhone)}
      verified={verified}
      startAtCode={query.continue === '1'}
      pages={pages}
      fields={fields}
    />
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        {children}
      </div>
    </div>
  )
}

function LinkUnavailable({ closed }: { closed: boolean }) {
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-fg">{closed ? 'המסמך הזה כבר אינו פתוח לחתימה' : 'הקישור הזה כבר לא פעיל'}</h1>
      <p className="mt-2 text-sm text-muted">
        {closed ? 'אם לדעתכם זו טעות, פנו לשולח המסמך.' : 'אם קיבלתם הודעה חדשה יותר, פתחו את הקישור שבה. אחרת, פנו לשולח המסמך ובקשו קישור.'}
      </p>
    </Shell>
  )
}

function AlreadyDone({ title, status, token }: { title: string; status: string; token: string }) {
  const message =
    status === 'signed'
      ? 'המסמך כבר נחתם.'
      : status === 'declined'
        ? 'המסמך נדחה.'
        : status === 'canceled'
          ? 'בקשת החתימה בוטלה.'
          : 'תוקף בקשת החתימה פג.'

  return (
    <Shell>
      <p className="text-2xl" aria-hidden="true">
        {status === 'signed' ? '✓' : 'ⓘ'}
      </p>
      <h1 className="mt-2 text-lg font-semibold text-fg">{message}</h1>
      <p className="mt-2 text-sm text-muted">{title}</p>
      {status === 'signed' ? (
        <a href={`/api/sign/${token}/download`} className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-6 text-sm font-medium text-white">
          הורדת המסמך החתום
        </a>
      ) : null}
    </Shell>
  )
}
