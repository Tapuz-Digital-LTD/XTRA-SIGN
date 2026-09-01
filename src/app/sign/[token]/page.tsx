import { SignerFlow } from '@/components/signer/SignerFlow'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { loadFields, loadPageGeometry } from '@/server/documents/save-fields'
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

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolveSigningToken(token)

  // Unknown, expired and revoked all render the same page — distinguishing them
  // would tell someone guessing tokens which ones exist.
  if (!context) return <LinkUnavailable />

  const verified = await hasVerifiedSession(context)

  if (!isSignable(context.status)) {
    return <AlreadyDone title={context.title} status={context.status} />
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

function LinkUnavailable() {
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-fg">הקישור אינו זמין</h1>
      <p className="mt-2 text-sm text-muted">
        ייתכן שפג תוקפו או שהמסמך כבר טופל. אפשר לפנות לשולח המסמך ולבקש קישור חדש.
      </p>
    </Shell>
  )
}

function AlreadyDone({ title, status }: { title: string; status: string }) {
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
    </Shell>
  )
}
