import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyTabs } from '@/components/companies/CompanyTabs'
import { SourceBar, SourceGate, parseSourceView } from '@/components/companies/SourceGate'
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
  const source = parseSourceView(params.source)
  const kept = { from: params.from, to: params.to, status: params.status }

  // No side chosen: ask, and count nothing. "כל המקורות" is asked for by name.
  if (!source) {
    return (
      <AppShell>
        <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
        <SourceGate base="/customers/reports" plural="לקוחות" params={kept} allowAll />
      </AppShell>
    )
  }

  const filters = parseReportFilters({ kind: 'customer', ...params, source: source === 'all' ? undefined : source })
  const [kpis, rows, series, breakdown] = await Promise.all([
    agreementReport(session, filters),
    reportRows(session, filters, 100),
    signedOverTime(session, filters),
    // Both sources together are only ever shown broken down by source.
    source === 'all'
      ? Promise.all(
          (['xtra', 'crm'] as const).map(async (part) => ({
            label: part === 'crm' ? 'CRM' : 'XTRA Sign',
            kpis: await agreementReport(session, { ...filters, source: part }),
          })),
        )
      : undefined,
  ])

  const query = new URLSearchParams({ kind: 'customer' })
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (source !== 'all') query.set('source', source)
  if (filters.status) query.set('status', filters.status)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">לקוחות</h1>
      <SourceBar base="/customers/reports" source={source} params={kept} />
      <CompanyTabs base="/customers" active="reports" listLabel="לקוחות" source={source} />
      <div className="mt-5">
        <ReportPanel
          kpis={kpis}
          rows={rows}
          rowLimit={100}
          series={series}
          action="/customers/reports"
          exportHref={`/api/reports/export?${query}`}
          hidden={{ source }}
          values={params}
          breakdown={breakdown}
        />
      </div>
    </AppShell>
  )
}
