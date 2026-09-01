import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { FieldEditor } from '@/components/editor/FieldEditor'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { loadFields, loadPageGeometry } from '@/server/documents/save-fields'
import { getDocumentDetail } from '@/server/documents/queries'

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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

  // A sent or signed document is frozen. Editing it would change what the
  // signer agreed to; a change means a new version, not an edit in place.
  if (agreement.status !== 'draft') redirect(`/documents/${id}`)

  const [doc, pages, fields] = await Promise.all([
    getDocumentDetail(id),
    loadPageGeometry(agreement.currentVersionId ?? ''),
    loadFields(agreement.currentVersionId ?? ''),
  ])

  if (!doc) notFound()

  if (pages.length === 0) {
    return (
      <AppShell>
        <h1 className="text-2xl font-bold tracking-tight text-fg">{doc.title}</h1>
        <p
          role="status"
          className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted"
        >
          לא הצלחנו להכין תצוגה של המסמך, ולכן לא ניתן להוסיף שדות. ניתן להוריד את
          הקובץ המקורי ולהעלות אותו מחדש כ-PDF.
        </p>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-fg">{doc.title}</h1>
          <p className="text-xs text-muted">
            {/* Progress, in the four steps the spec asks for. */}
            1. מסמך → <span className="font-medium text-fg">2. שדות</span> → 3. חותם → 4. שליחה
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            href={`/documents/${id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50"
          >
            סיום
          </Link>
          <Link
            href={`/documents/${id}/send`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            המשך לשליחה
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <FieldEditor
          documentId={id}
          pages={pages}
          initialFields={fields}
          initialRecipient={
            doc.recipient
              ? {
                  name: doc.recipient.name,
                  company: doc.recipient.company,
                  phone: doc.recipient.phone,
                  email: doc.recipient.email,
                }
              : null
          }
        />
      </div>
    </AppShell>
  )
}
