import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyList } from '@/components/companies/CompanyList'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { getSession } from '@/server/auth/session'
import { listCompanies } from '@/server/companies/companies'
import { getCrmProvider } from '@/server/crm/fireberry'
import { listGroups } from '@/server/groups/groups'

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { q, group } = await searchParams

  const [companies, groups] = await Promise.all([
    listCompanies(session, 'supplier', q, group),
    listGroups(session, 'supplier'),
  ])

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">ספקים</h1>
      <p className="mt-1 text-sm text-muted">
        כל ספק במקום אחד — הפרטים שלו וכל המסמכים שנשלחו אליו לחתימה.
      </p>
      <CompanyTabs base="/suppliers" active="list" listLabel="ספקים" />
      <div className="mt-5">
        <CompanyList companies={companies} kind="supplier" search={q ?? ''} groups={groups} activeGroup={group ?? null} noun="ספק" crmEnabled={getCrmProvider().isConfigured()} />
      </div>
    </AppShell>
  )
}
