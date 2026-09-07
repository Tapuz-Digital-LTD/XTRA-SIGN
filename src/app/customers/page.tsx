import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyList } from '@/components/companies/CompanyList'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { SourceBar, SourceGate, withSource } from '@/components/companies/SourceGate'
import { getSession } from '@/server/auth/session'
import { listCompanies, parseCompanySource } from '@/server/companies/companies'
import { getCrmProvider } from '@/server/crm/fireberry'
import { listGroups } from '@/server/groups/groups'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string; view?: string; source?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { q, group, view, source: sourceParam } = await searchParams
  const source = parseCompanySource(sourceParam)

  // No side chosen: ask, and list nothing. The choice then lives in the URL.
  if (!source) {
    return (
      <AppShell>
        <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
        <p className="mt-1 text-sm text-muted">
          כל לקוח במקום אחד — הפרטים שלו וכל המסמכים שנשלחו אליו לחתימה.
        </p>
        <SourceGate base="/customers" plural="לקוחות" params={{ q, group, view }} />
      </AppShell>
    )
  }

  const archived = view === 'archive'
  // Both queries take the source: the rows and the group chips' counts are
  // about one side only.
  const [companies, groups] = await Promise.all([
    listCompanies(session, 'customer', q, group, archived, source),
    listGroups(session, 'customer', { source }),
  ])

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
      <p className="mt-1 text-sm text-muted">
        כל לקוח במקום אחד — הפרטים שלו וכל המסמכים שנשלחו אליו לחתימה.
      </p>
      <SourceBar base="/customers" source={source} params={{ q, group, view }} />
      <CompanyTabs base="/customers" active="list" listLabel="לקוחות" source={source} />
      <div className="mt-3 flex justify-end">
        <Link href={withSource('/customers', source, { view: archived ? undefined : 'archive' })} className="text-xs text-muted hover:text-fg hover:underline">
          {archived ? '← חזרה לרשימה הפעילה' : 'ארכיון'}
        </Link>
      </div>
      <div className="mt-5">
        <CompanyList companies={companies} kind="customer" search={q ?? ''} groups={groups} activeGroup={group ?? null} source={source} noun="לקוח" crmEnabled={getCrmProvider().isConfigured()} isAdmin={session.isAdmin} archivedView={archived} />
      </div>
    </AppShell>
  )
}
