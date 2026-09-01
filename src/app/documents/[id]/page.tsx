import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentPreview } from '@/components/DocumentPreview'
import { StatusBadge } from '@/components/StatusBadge'
import { Timeline } from '@/components/Timeline'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { getDocumentDetail } from '@/server/documents/queries'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params

  // Authorization first, and a refusal renders as not-found so the page cannot
  // be used to confirm which ids exist.
  try {
    await authorizeAgreementAccess(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }

  const doc = await getDocumentDetail(id)
  if (!doc) notFound()

  return (
    <AppShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-fg">{doc.title}</h1>
          <div className="mt-2">
            <StatusBadge status={doc.status} />
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <a
            href={`/api/documents/${doc.id}/download?type=source`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
          >
            הורדת מסמך
          </a>
          {doc.status === 'draft' && doc.hasRendered ? (
            <Link
              href={`/documents/${doc.id}/edit`}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              הוספת שדות
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-label="תצוגת המסמך">
          {doc.wasConverted && doc.status === 'draft' ? (
            <p
              role="status"
              className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-fg"
            >
              המסמך מוכן. מומלץ לעבור עליו ולוודא שהכול נראה כמו שצריך.
            </p>
          ) : null}

          {doc.hasRendered && doc.pageCount ? (
            <DocumentPreview documentId={doc.id} pageCount={doc.pageCount} />
          ) : (
            <p
              role="status"
              className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted"
            >
              לא הצלחנו להכין תצוגה של המסמך. ניתן להוריד את הקובץ המקורי.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">החותם</h2>
            {doc.recipient ? (
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">שם</dt>
                  <dd className="text-fg">{doc.recipient.name}</dd>
                </div>
                {doc.recipient.company ? (
                  <div>
                    <dt className="text-xs text-muted">חברה</dt>
                    <dd className="text-fg">{doc.recipient.company}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">טרם נבחר חותם.</p>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">היסטוריית המסמך</h2>
            <Timeline events={doc.timeline} />
          </div>
        </aside>
      </div>
    </AppShell>
  )
}
