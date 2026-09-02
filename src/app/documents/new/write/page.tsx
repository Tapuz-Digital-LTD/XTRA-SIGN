import { notFound, redirect } from 'next/navigation'
import { UnifiedComposer } from '@/components/composer/UnifiedComposer'
import { getSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'

/** Writing a document from scratch: content, layout and fields in one screen. */
export default async function WritePage({
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

  return <UnifiedComposer companyId={company.id} companyName={company.name} />
}
