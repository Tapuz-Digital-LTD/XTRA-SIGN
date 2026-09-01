import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { SendPanel } from '@/components/SendPanel'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { buildSendSummary } from '@/server/documents/send-validation'

export default async function SendPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params

  let agreement
  try {
    agreement = await authorizeAgreementAccess(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }

  if (agreement.status !== 'draft') redirect(`/documents/${id}`)

  // Built with no channels selected, so the summary lists only the blockers
  // that are true regardless of how it will be sent. The channel-specific ones
  // appear when the user picks a channel and presses send.
  const summary = await buildSendSummary(agreement.id, agreement.currentVersionId, [])

  return (
    <AppShell>
      <div className="mx-auto max-w-lg">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs text-muted">
            1. מסמך → 2. שדות → 3. חותם → <span className="font-medium text-fg">4. שליחה</span>
          </p>
          <Link
            href={`/documents/${id}/edit`}
            className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
          >
            חזרה לעריכה
          </Link>
        </div>

        <div className="mt-5">
          <SendPanel documentId={id} summary={summary} />
        </div>
      </div>
    </AppShell>
  )
}
