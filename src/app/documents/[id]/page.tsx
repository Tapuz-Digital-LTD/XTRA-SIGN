import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentPreview } from '@/components/DocumentPreview'
import { SaveAsTemplate } from '@/components/SaveAsTemplate'
import { CrmUploadButton } from '@/components/CrmUploadButton'
import { RemindButton } from '@/components/RemindButton'
import { StatusBadge } from '@/components/StatusBadge'
import { Timeline } from '@/components/Timeline'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { getCompany } from '@/server/companies/companies'
import { getCrmProvider } from '@/server/crm/fireberry'
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

  // The CRM button appears only when the whole chain is real: the CRM is
  // configured, the document is signed and filed under a company, and that
  // company carries a CRM record id. Otherwise it would be a dead button.
  const crmReady =
    doc.status === 'signed' &&
    doc.company != null &&
    getCrmProvider().isConfigured() &&
    Boolean((await getCompany(session, doc.company.id))?.crmRecordId)

  const expiryFormatter = new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <AppShell>
      {doc.company ? (
        <div className="mb-4">
          <Link
            href={`/companies/${doc.company.id}`}
            className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
          >
            → {doc.company.name}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-fg">{doc.title}</h1>
          <div className="mt-2">
            <StatusBadge status={doc.status} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {doc.hasRendered ? <SaveAsTemplate documentId={doc.id} defaultName={doc.title} /> : null}
          <a
            href={`/api/documents/${doc.id}/download?type=${doc.status === 'signed' ? 'signed' : 'source'}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
          >
            {doc.status === 'signed' ? 'הורדת מסמך חתום' : 'הורדת מסמך'}
          </a>
          {crmReady ? <CrmUploadButton documentId={doc.id} /> : null}
          {doc.status === 'draft' && doc.hasRendered ? (
            <Link
              href={`/documents/${doc.id}/edit`}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              הוספת שדות
            </Link>
          ) : null}
          {(doc.status === 'sent' || doc.status === 'viewed') && doc.recipient ? (
            <RemindButton
              documentId={doc.id}
              hasPhone={Boolean(doc.recipient.phone)}
              hasEmail={Boolean(doc.recipient.email)}
            />
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

          {doc.hasRendered && doc.pages.length > 0 ? (
            <DocumentPreview documentId={doc.id} pages={doc.pages} />
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

          {/* Link validity — only meaningful once the document has been sent. */}
          {doc.expiresAt && (doc.status === 'sent' || doc.status === 'viewed') ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-fg">קישור החתימה</h2>
              <p className="mt-2 text-sm text-fg">
                {doc.linkExpired ? 'פג בתאריך' : 'בתוקף עד'}{' '}
                <time dateTime={new Date(doc.expiresAt).toISOString()} className="font-medium">
                  {expiryFormatter.format(new Date(doc.expiresAt))}
                </time>
              </p>
              <p className="mt-1 text-xs text-muted">
                החותם יכול לפתוח את הקישור שוב עד למועד זה. תזכורת נשלחת אוטומטית לפני שהמסמך נחתם.
              </p>
            </div>
          ) : null}

          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">היסטוריית המסמך</h2>
            <Timeline events={doc.timeline} />
          </div>
        </aside>
      </div>
    </AppShell>
  )
}
