import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { SourceSwitch, parseSourceView } from '@/components/companies/SourceSwitch'
import { ReportPanel } from '@/components/reports/ReportPanel'
import { getSession } from '@/server/auth/session'
import { agreementReport, parseReportFilters, reportRows, signedOverTime } from '@/server/reports/reports'

export default async function SupplierReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string; status?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const params = await searchParams

  // One side by default; "כל המקורות" is asked for by name and then shown broken down.
  const source = parseSourceView(params.source)
  const filters = parseReportFilters({ kind: 'supplier', ...params, source: source === 'all' ? undefined : source })
  const [kpis, rows, series, breakdown] = await Promise.all([
    agreementReport(session, filters),
    reportRows(session, filters, 100),
    signedOverTime(session, filters),
    source === 'all'
      ? Promise.all(
          (['xtra', 'crm'] as const).map(async (part) => ({
            label: part === 'crm' ? 'CRM' : 'XTRA Sign',
            kpis: await agreementReport(session, { ...filters, source: part }),
          })),
        )
      : undefined,
  ])

  const query = new URLSearchParams({ kind: 'supplier' })
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (source !== 'all') query.set('source', source)
  if (filters.status) query.set('status', filters.status)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">ספקים</h1>
      <div className="mt-4">
        <SourceSwitch base="/suppliers/reports" source={source} params={{ from: params.from, to: params.to, status: filters.status }} allowAll />
      </div>
      <CompanyTabs base="/suppliers" active="reports" listLabel="ספקים" source={source} />
      <div className="mt-5">
        <ReportPanel
          kpis={kpis}
          rows={rows}
          rowLimit={100}
          series={series}
          action="/suppliers/reports"
          exportHref={`/api/reports/export?${query}`}
          hidden={source === 'xtra' ? {} : { source }}
          values={params}
          breakdown={breakdown}
        />
      </div>
    </AppShell>
  )
}
