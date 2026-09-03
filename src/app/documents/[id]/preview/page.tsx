import { notFound, redirect } from 'next/navigation'
import { PreviewViewer } from '@/components/PreviewViewer'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { getDocumentDetail } from '@/server/documents/queries'
import { loadFields, loadPageGeometry } from '@/server/documents/save-fields'

/** A near-full-screen, read-only preview of the document with its fields. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [doc, pages, fields] = await Promise.all([
    getDocumentDetail(id),
    loadPageGeometry(agreement.currentVersionId ?? ''),
    // A signed file carries its values — signature included — inside the PDF;
    // placeholder boxes drawn on top would cover the real signature.
    agreement.status === 'signed' ? Promise.resolve([]) : loadFields(agreement.currentVersionId ?? ''),
  ])
  if (!doc || pages.length === 0) notFound()

  // From a draft you came from the editor; from a sent/signed document, the
  // document page. Back goes where it makes sense.
  const backHref = agreement.status === 'draft' ? `/documents/${id}/edit` : `/documents/${id}`

  return <PreviewViewer documentId={id} title={doc.title} pages={pages} fields={fields} backHref={backHref} />
}
