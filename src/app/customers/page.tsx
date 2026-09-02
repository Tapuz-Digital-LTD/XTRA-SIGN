import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyList } from '@/components/companies/CompanyList'
import { getSession } from '@/server/auth/session'
import { listCompanies } from '@/server/companies/companies'
import { getCrmProvider } from '@/server/crm/fireberry'

export default async function CustomersPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const companies = await listCompanies(session, 'customer')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
      <p className="mt-1 text-sm text-muted">
        כל לקוח במקום אחד — הפרטים שלו וכל המסמכים שנשלחו אליו לחתימה.
      </p>
      <div className="mt-6">
        <CompanyList companies={companies} kind="customer" noun="לקוח" crmEnabled={getCrmProvider().isConfigured()} />
      </div>
    </AppShell>
  )
}
