import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentsTable } from '@/components/documents/DocumentsTable'
import { GroupWorkspace } from '@/components/groups/GroupWorkspace'
import { LeadsPanel } from '@/components/projects/LeadsPanel'
import { ProjectSettings } from '@/components/projects/ProjectSettings'
import { ReportPanel } from '@/components/reports/ReportPanel'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { listBatches } from '@/server/groups/bulk-send'
import { authorizeGroup, listGroupCompanies } from '@/server/groups/groups'
import { listDocuments } from '@/server/documents/queries'
import { listLeads } from '@/server/projects/leads'
import { getLandingSettings } from '@/server/projects/landing'
import { agreementReport, parseReportFilters, reportRows, signedOverTime } from '@/server/reports/reports'
import { listTemplates } from '@/server/templates/templates'

const TABS = ['suppliers', 'leads', 'agreements', 'reports', 'settings'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  suppliers: 'ספקים',
  leads: 'לידים',
  agreements: 'הסכמים',
  reports: 'דוחות',
  settings: 'הגדרות',
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string; status?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const query = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(query.tab ?? '') ? (query.tab as Tab) : 'suppliers'

  let project
  try {
    project = await authorizeGroup(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }

  // Every render needs the members (the header counts them) and the lead count
  // (the tab badge); the rest is fetched only for the open tab.
  const [companies, leads] = await Promise.all([
    listGroupCompanies(session, id, tab === 'suppliers' ? query.q : undefined),
    listLeads(session, id),
  ])
  const newLeadCount = leads.filter((l) => l.status === 'new').length

  const href = (next: Tab) => `/projects/${id}${next === 'suppliers' ? '' : `?tab=${next}`}`

  return (
    <AppShell>
      <div className="mb-4">
        <Link href="/projects" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
          → לכל הפרויקטים
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">{project.name}</h1>
        {/* One quiet line, not a dashboard: how many, how it's going. */}
        <p className="mt-1 text-sm text-muted">
          {companies.length === 1 ? 'ספק אחד' : `${companies.length} ספקים`}
          {' · '}
          {companies.filter((c) => c.lastSend?.status === 'signed').length} חתמו
          {' · '}
          {companies.filter((c) => c.lastSend && ['sent', 'viewed'].includes(c.lastSend.status)).length} ממתינים
        </p>
      </div>

      <nav className="-mx-1 mt-5 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="לשוניות הפרויקט">
        {TABS.map((key) => (
          <Link
            key={key}
            href={href(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition ${
              tab === key
                ? 'border-brand font-semibold text-fg'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {TAB_LABELS[key]}
            {key === 'leads' && newLeadCount > 0 ? (
              <span className="rounded-full bg-blue-100 px-1.5 text-xs font-medium text-blue-800">{newLeadCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'suppliers' ? <SuppliersTab projectId={id} projectName={project.name} companies={companies} search={query.q ?? ''} session={session} /> : null}
        {tab === 'leads' ? <LeadsPanel projectId={id} leads={leads} /> : null}
        {tab === 'agreements' ? <AgreementsTab projectId={id} session={session} /> : null}
        {tab === 'reports' ? <ReportsTab projectId={id} from={query.from} to={query.to} status={query.status} session={session} /> : null}
        {tab === 'settings' ? (
          <ProjectSettings
            projectId={id}
            projectName={project.name}
            projectDescription={project.description}
            landing={await getLandingSettings(session, id)}
          />
        ) : null}
      </div>
    </AppShell>
  )
}

async function SuppliersTab({
  projectId,
  projectName,
  companies,
  search,
  session,
}: {
  projectId: string
  projectName: string
  companies: Awaited<ReturnType<typeof listGroupCompanies>>
  search: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
}) {
  const [templates, batches] = await Promise.all([listTemplates(session), listBatches(session, projectId)])
  const usable = templates
    .filter((t) => t.signatureCount > 0 && t.pageCount !== null)
    .map((t) => ({ id: t.id, name: t.name, signatureCount: t.signatureCount }))

  return (
    <>
      <GroupWorkspace groupId={projectId} groupName={projectName} companies={companies} templates={usable} search={search} />

      {batches.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-fg">שליחות אחרונות</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {batches.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{batch.templateName ?? 'תבנית'}</span>
                  <span className="block text-xs text-muted">{dateFormat.format(batch.createdAt)}</span>
                </span>
                <span className="text-sm text-muted">
                  {batch.sent} נשלחו · {batch.signed} נחתמו
                  {batch.failed > 0 ? ` · ${batch.failed} נכשלו` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

async function AgreementsTab({
  projectId,
  session,
}: {
  projectId: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
}) {
  const result = await listDocuments(session, { groupId: projectId, pageSize: 100 })
  if (result.items.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
        עדיין לא נשלחו הסכמים מהפרויקט הזה. שולחים מתוך לשונית הספקים.
      </p>
    )
  }
  return <DocumentsTable documents={result.items} now={result.now} />
}

async function ReportsTab({
  projectId,
  from,
  to,
  status,
  session,
}: {
  projectId: string
  from?: string
  to?: string
  status?: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
}) {
  const filters = parseReportFilters({ group: projectId, from, to, status })
  const [kpis, rows, series] = await Promise.all([
    agreementReport(session, filters),
    reportRows(session, filters, 100),
    signedOverTime(session, filters),
  ])
  const query = new URLSearchParams({ group: projectId })
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  if (filters.status) query.set('status', filters.status)

  return (
    <ReportPanel
      kpis={kpis}
      rows={rows}
      rowLimit={100}
      series={series}
      action={`/projects/${projectId}`}
      hidden={{ tab: 'reports' }}
      values={{ from, to, status }}
      exportHref={`/api/reports/export?${query}`}
    />
  )
}
