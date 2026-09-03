import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyList } from '@/components/companies/CompanyList'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { getSession } from '@/server/auth/session'
import { listCompanies } from '@/server/companies/companies'
import { getCrmProvider } from '@/server/crm/fireberry'
import { listGroups } from '@/server/groups/groups'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { q, group } = await searchParams

  const [companies, groups] = await Promise.all([
    listCompanies(session, 'customer', q, group),
    listGroups(session, 'customer'),
  ])

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
      <p className="mt-1 text-sm text-muted">
        כל לקוח במקום אחד — הפרטים שלו וכל המסמכים שנשלחו אליו לחתימה.
      </p>
      <CompanyTabs base="/customers" active="list" listLabel="לקוחות" />
      <div className="mt-5">
        <CompanyList companies={companies} kind="customer" search={q ?? ''} groups={groups} activeGroup={group ?? null} noun="לקוח" crmEnabled={getCrmProvider().isConfigured()} />
      </div>
    </AppShell>
  )
}
