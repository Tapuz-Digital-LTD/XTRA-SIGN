import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { ReportPanel } from '@/components/reports/ReportPanel'
import { getSession } from '@/server/auth/session'
import { agreementReport, parseReportFilters } from '@/server/reports/reports'

export default async function SupplierReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const params = await searchParams

  const filters = parseReportFilters({ kind: 'supplier', ...params })
  const kpis = await agreementReport(session, filters)

  const query = new URLSearchParams({ kind: 'supplier' })
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.source) query.set('source', params.source)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">ספקים</h1>
      <CompanyTabs base="/suppliers" active="reports" listLabel="ספקים" />
      <div className="mt-5">
        <ReportPanel
          kpis={kpis}
          action="/suppliers/reports"
          exportHref={`/api/reports/export?${query}`}
          values={params}
          showSource
        />
      </div>
    </AppShell>
  )
}
