import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentComposer } from '@/components/DocumentComposer'
import { getSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'

export default async function ComposeDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { company: companyParam } = await searchParams
  const company = companyParam ? await getCompany(session, companyParam) : null

  return (
    <AppShell>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">כתיבת מסמך</h1>
          <p className="mt-1 text-xs text-muted">
            <span className="font-medium text-fg">1. מסמך</span> → 2. שדות → 3. חותם → 4. שליחה
          </p>
        </div>
        <Link
          href={company ? `/documents/new?company=${company.id}` : '/documents/new'}
          className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          חזרה
        </Link>
      </div>

      <div className="mt-6">
        <DocumentComposer companyId={company?.id ?? null} />
      </div>
    </AppShell>
  )
}
