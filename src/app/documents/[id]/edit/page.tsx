import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { FieldEditor } from '@/components/editor/FieldEditor'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { loadFields, loadPageGeometry } from '@/server/documents/save-fields'
import { getDocumentDetail } from '@/server/documents/queries'

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
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
          לא הצלחנו להכין תצוגה של המסמך, ולכן לא ניתן להוסיף שדות. ניתן להוריד את הקובץ המקורי
          ולהעלות אותו מחדש כ-PDF.
        </p>
        <div className="mt-4 text-center">
          <Link href={`/documents/${id}`} className="text-sm text-brand underline">
            חזרה למסמך
          </Link>
        </div>
      </AppShell>
    )
  }

  // The editor is document-first: it takes the whole viewport, without the site
  // navigation, so the page itself is the largest thing on screen.
  return (
    <FieldEditor
      documentId={id}
      title={doc.title}
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
  )
}
