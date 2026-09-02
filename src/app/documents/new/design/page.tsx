import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { CanvasEditor } from '@/components/canvas/CanvasEditor'
import { XtraAi } from '@/components/ai/XtraAi'
import { getSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'

/** Designing a document from scratch on A4 artboards. */
export default async function DesignPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { company: companyId } = await searchParams
  if (!companyId) redirect('/documents/new')

  const company = await getCompany(session, companyId)
  if (!company) notFound()

  return (
    <>
      <CanvasEditor companyId={company.id} companyName={company.name} />
      <Suspense fallback={null}>
        <XtraAi />
      </Suspense>
    </>
  )
}
