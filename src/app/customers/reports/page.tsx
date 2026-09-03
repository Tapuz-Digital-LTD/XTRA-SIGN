import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { ReportPanel } from '@/components/reports/ReportPanel'
import { getSession } from '@/server/auth/session'
import { agreementReport, parseReportFilters, reportRows, signedOverTime } from '@/server/reports/reports'

export default async function CustomerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string; status?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const params = await searchParams

  const filters = parseReportFilters({ kind: 'customer', ...params })
  const [kpis, rows, series] = await Promise.all([
    agreementReport(session, filters),
    reportRows(session, filters, 100),
    signedOverTime(session, filters),
  ])

  const query = new URLSearchParams({ kind: 'customer' })
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.source) query.set('source', params.source)
  if (filters.status) query.set('status', filters.status)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
      <CompanyTabs base="/customers" active="reports" listLabel="לקוחות" />
      <div className="mt-5">
        <ReportPanel
          kpis={kpis}
          rows={rows}
          rowLimit={100}
          series={series}
          action="/customers/reports"
          exportHref={`/api/reports/export?${query}`}
          values={params}
          showSource
        />
      </div>
    </AppShell>
  )
}
