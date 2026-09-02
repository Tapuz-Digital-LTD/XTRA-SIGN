import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { CanvasEditor } from '@/components/canvas/CanvasEditor'
import { XtraAi } from '@/components/ai/XtraAi'
import { getSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { getCompany } from '@/server/companies/companies'
import { parseCanvasDocument } from '@/server/documents/canvas-save'

/** Reopening a designed document, exactly as it was left. */
export default async function EditDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const agreement = await authorizeAgreementAccess(session, id)
  const document = parseCanvasDocument(agreement.canvasDocument)
  // A document that did not come from the canvas has no layout to open; the
  // PDF field editor is the right screen for those.
  if (!document) redirect(`/documents/${id}/edit`)
  if (!agreement.companyId) notFound()

  const company = await getCompany(session, agreement.companyId)
  if (!company) notFound()

  return (
    <>
      <CanvasEditor
        companyId={company.id}
        companyName={company.name}
        agreementId={agreement.id}
        initialDocument={document}
        initialTitle={agreement.title}
      />
      <Suspense fallback={null}>
        <XtraAi />
      </Suspense>
    </>
  )
}
