import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentsTable } from '@/components/documents/DocumentsTable'
import { GroupWorkspace } from '@/components/groups/GroupWorkspace'
import { BackLink } from '@/components/nav/BackLink'
import { ScrollRestore } from '@/components/nav/ScrollRestore'
import { readReturnTo, withReturnTo } from '@/lib/return-to'
import { AudienceTable } from '@/components/projects/AudienceTable'
import { TabPicker } from '@/components/projects/TabPicker'
import { SetupTable, type SetupRow } from '@/components/follow-up/SetupTable'
import { cleanFollowUpConfig, taskCounts } from '@/server/follow-up/tasks'
import { runReport } from '@/server/reports/engine/query'
import { inArray } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { listAudience, type AudienceView } from '@/server/invitations/invitations'
import { ProjectSettings } from '@/components/projects/ProjectSettings'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { listBatches } from '@/server/groups/bulk-send'
import { authorizeGroup, listGroupCompanies } from '@/server/groups/groups'
import { listDocuments } from '@/server/documents/queries'
import { listLeads } from '@/server/projects/leads'
import { getLandingSettings } from '@/server/projects/landing'
import { getSelfServiceConfig } from '@/server/projects/self-service'
import { listUsers } from '@/server/users/users'
import type { StaffSession } from '@/server/auth/session'
import { publicBaseUrl } from '@/server/http/public-url'
import { parseProjectReportFilters, projectReport, registrationCount, registrationRows, type ProjectReport, type RegistrationRow } from '@/server/reports/project-report'
import { RegistrationsTable } from '@/components/reports/RegistrationsTable'
import { ProjectReportView, type ProjectReportData } from '@/components/reports/ProjectReportView'
import { missingRoles } from '@/lib/agreement-roles'
import { ExportButton } from '@/components/reports/ExportButton'
import type { ReportDefinition } from '@/server/reports/engine/types'
import { describeCampaign, entryLabel, goalLabel, isCampaignKind, JOINING_VIEWS, LEGACY_JOINING_VIEWS, LEGACY_TABS, TAB_INTROS, TAB_LABELS, tabsFor, type CampaignKind, type CampaignTab, type JoiningView } from '@/lib/campaigns'
import { CampaignOverview } from '@/components/projects/CampaignOverview'
import { DistributionsTab } from '@/components/projects/DistributionsTab'
import type { PlacedField } from '@/lib/fields'
import { getProjectNotificationSettings } from '@/server/projects/notification-settings'
import { getPublicSlugSettings } from '@/server/projects/public-slug'
import { authorizeTemplateAccess, listTemplates, templateRoles } from '@/server/templates/templates'

type Tab = CampaignTab

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string; status?: string; source?: string; range?: string; setup?: string; new?: string; section?: string; returnTo?: string; view?: string; filter?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const query = await searchParams

  let project
  try {
    project = await authorizeGroup(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }
  const campaignKind: CampaignKind = isCampaignKind(project.campaignKind) ? project.campaignKind : 'signature'
  const selfService = (project.landingConfig as { selfService?: { enabled?: boolean; skin?: string | null } } | null)?.selfService
  const shape = describeCampaign({ goal: project.goal, entryMethod: project.entryMethod, campaignKind: project.campaignKind, selfServiceEnabled: selfService?.enabled === true, selfServiceSkin: selfService?.skin ?? null, landingEnabled: project.landingEnabled })
  // "הקמת מוצרים באתר" has its own place when the campaign creates that task, or already has some.
  const setupCounts = await taskCounts(session, id)
  const setupEnabled = cleanFollowUpConfig(project.followUpConfig).afterSign.includes('site_product') || Object.values(setupCounts).some((n) => n > 0)
  const TABS = tabsFor(shape.entry, { setup: setupEnabled })
  const requested = LEGACY_TABS[query.tab ?? ''] ?? query.tab
  if (query.tab === 'registrations' && !query.view) query.view = 'registrations'
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? '') ? (requested as Tab) : 'overview'

  // Every render needs the members (the header counts them) and the lead count
  // (the tab badge); the rest is fetched only for the open tab.
  const [companies, leads] = await Promise.all([
    listGroupCompanies(session, id, tab === 'audience' ? query.q : undefined),
    listLeads(session, id),
  ])
  const newLeadCount = leads.filter((l) => l.status === 'new').length

  // "חזרה" goes to the campaigns list as it was filtered; the tabs keep it.
  const returnTo = readReturnTo(query.returnTo)
  const href = (next: Tab) => withReturnTo(`/projects/${id}${next === 'overview' ? '' : `?tab=${next}`}`, returnTo)

  return (
    <AppShell>
      <ScrollRestore />
      <BackLink returnTo={returnTo} fallback="/projects" />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-fg">{project.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shape.goal === 'signing' ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'}`}>{goalLabel(shape.goal)}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{entryLabel(shape.entry)}</span>
          {project.archivedAt ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">בארכיון</span> : null}
        </div>
        {/* One quiet line, not a dashboard: how many, how it's going. */}
        <p className="mt-1 text-sm text-muted">
          {companies.length === 1 ? 'נמען אחד' : `${companies.length} נמענים`}
          {' · '}
          {companies.filter((c) => c.lastSend?.status === 'signed').length} חתמו
          {' · '}
          {companies.filter((c) => c.lastSend && ['sent', 'viewed'].includes(c.lastSend.status)).length} ממתינים
          {project.startsAt || project.endsAt ? ` · ${project.startsAt ? dateFormat.format(project.startsAt) : '…'} – ${project.endsAt ? dateFormat.format(project.endsAt) : '…'}` : ''}
        </p>
      </div>

      <div className="mt-5">
        <TabPicker current={tab} options={TABS.map((key) => ({ key, label: TAB_LABELS[key], href: href(key), badge: key === 'joining' ? newLeadCount : undefined }))} />
      </div>
      <nav className="-mx-1 mt-2 hidden gap-1 border-b border-line px-1 md:flex md:flex-wrap" aria-label="לשוניות הפרויקט">
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
            {key === 'joining' && newLeadCount > 0 ? (
              <span className="rounded-full bg-blue-100 px-1.5 text-xs font-medium text-blue-800">{newLeadCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-fg">{TAB_LABELS[tab]}</h2>
          <p className="mt-1 text-sm text-muted">{TAB_INTROS[tab]}</p>
        </div>
        {tab === 'overview' ? <OverviewTab projectId={id} projectName={project.name} campaignKind={campaignKind} companies={companies} leads={leads} session={session} setup={setupEnabled ? { pending: setupCounts.pending, inProgress: setupCounts.in_progress, done: setupCounts.done } : null} /> : null}
        {tab === 'audience' ? <SuppliersTab projectId={id} projectName={project.name} companies={companies} search={query.q ?? ''} session={session} /> : null}
        {tab === 'joining' ? <JoiningTab projectId={id} session={session} query={query} askKind={project.kind === null} audienceNoun={project.kind === 'customer' ? 'לקוח' : 'ספק'} publicUrl={await publicAddress(session, id)} /> : null}
        {tab === 'distributions' ? (
          <>
            <TableExport definition={{ entity: 'sends', clauses: [inCampaign(id)], columns: ['sent_at', 'person', 'recipient', 'channel', 'event', 'result', 'error', 'agreement_title', 'sent_by_name'], sort: { field: 'sent_at', dir: 'desc' } }} label="ייצוא שליחות לאקסל" />
            <DistributionsTab projectId={id} campaignKind={campaignKind} publicUrl={campaignKind === 'public' ? await publicAddress(session, id) : null} isAdmin={session.isAdmin} openNew={query.new === '1'} />
          </>
        ) : null}
        {tab === 'agreements' ? <AgreementsTab projectId={id} session={session} filter={query.filter} /> : null}
        {tab === 'setup' ? <SetupTab projectId={id} session={session} query={query} /> : null}
        {tab === 'reports' ? <ReportsTab projectId={id} query={query} session={session} /> : null}
        {tab === 'settings' ? (
          <ProjectSettings
            projectId={id}
            projectName={project.name}
            projectDescription={project.description}
            landing={await getLandingSettings(session, id)}
            selfService={await getSelfServiceConfig(session, id)}
            publicSlug={await publicSlugView(session, id)}
            publicBase={publicBaseUrl()}
            agreement={await activeAgreement(session, (await getSelfServiceConfig(session, id)).templateId)}
            // Listing users is an admin power; everyone else sees the owner read-only.
            owners={session.isAdmin ? (await listUsers(session)).filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, email: u.email })) : []}
            currentUserId={session.userId}
            isAdmin={session.isAdmin}
            notifications={await getProjectNotificationSettings(session, id)}
            campaign={{
              campaignKind,
              goal: shape.goal,
              entry: shape.entry,
              registrationTarget: project.registrationTarget === 'crm' ? 'crm' : 'xtra_sign',
              status: project.status === 'paused' || project.status === 'ended' ? project.status : 'active',
              endedMessage: project.endedMessage ?? '',
              allowCompletionAfterEnd: project.allowCompletionAfterEnd !== false,
              startsAt: project.startsAt?.toISOString() ?? null,
              endsAt: project.endsAt?.toISOString() ?? null,
              registrationsAfterEnd: project.registrationsAfterEnd,
              linkTtlDays: project.linkTtlDays,
              ownerUserId: project.ownerUserId ?? null,
              defaultTemplateId: project.defaultTemplateId ?? null,
            }}
            templates={(await listTemplates(session)).map((t) => ({ id: t.id, name: t.name }))}
            setup={query.setup}
              section={query.section}
              registrantsNoun={project.kind === 'customer' ? 'לקוחות' : 'ספקים'}
            />
        ) : null}
      </div>
    </AppShell>
  )
}

/** סקירה — the campaign's front door: what needs attention, each card leading to the filtered view that acts on it. */
async function OverviewTab({ projectId, projectName, campaignKind, companies, leads, session, setup }: { projectId: string; projectName: string; campaignKind: CampaignKind; companies: Awaited<ReturnType<typeof listGroupCompanies>>; leads: Awaited<ReturnType<typeof listLeads>>; session: StaffSession; setup: { pending: number; inProgress: number; done: number } | null }) {
  const [audience, registrations, awaitingSignature, attention, publicUrl] = await Promise.all([
    listAudience(session, projectId, { view: 'all', limit: 1 }),
    registrationCount(projectId, {} as ReturnType<typeof parseProjectReportFilters>),
    registrationCount(projectId, { status: 'pending' }),
    listDocuments(session, { groupId: projectId, filter: 'attention', pageSize: 1 }),
    campaignKind === 'public' ? publicAddress(session, projectId) : Promise.resolve(null),
  ])
  const signed = companies.filter((c) => c.lastSend?.status === 'signed').length
  // The work first, then the totals. The invitations card appears only where
  // the team actually invited people, so a self-service campaign stays plain.
  const cards = [
    { label: 'ממתינים להשלמת חתימה', value: awaitingSignature, href: `/projects/${projectId}?tab=joining&view=registrations&status=pending` },
    ...(audience.counts.invitations > 0 ? [{ label: 'הזמנות פתוחות', value: audience.counts.invitations, href: `/projects/${projectId}?tab=joining&view=invitations` }] : []),
    { label: 'הרשמות שהתקבלו', value: registrations, href: `/projects/${projectId}?tab=joining&view=registrations` },
    { label: 'הסכמים שנחתמו', value: signed, href: `/projects/${projectId}?tab=agreements&filter=signed` },
    { label: 'דורשים טיפול', value: attention.total, href: `/projects/${projectId}?tab=agreements&filter=attention`, tone: attention.total > 0 ? ('warn' as const) : undefined },
  ]
  return <CampaignOverview project={{ id: projectId, name: projectName, campaignKind, publicUrl }} companies={companies} leads={leads} setup={setup} cards={cards} />
}


/**
 * "ייצוא לאקסל" for a campaign's table.
 *
 * Every tab that shows a list hands it over as a file, and the file is that
 * list: the same entity, the same conditions, the same columns, through the
 * report engine — the one place that knows how to turn a definition into
 * rows, with Hebrew headers, Israel-time dates and no field the registry does
 * not allow.
 */
function TableExport({ definition, label }: { definition: Parameters<typeof ExportButton>[0]['definition']; label?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <ExportButton definition={definition} label={label} />
    </div>
  )
}

/** Every campaign table starts from "this campaign". */
const inCampaign = (projectId: string): ReportDefinition['clauses'][number] => ({ any: [{ field: 'campaign', op: 'one_of', value: [projectId] }] })

/**
 * פניות והצטרפות — one list of people, three questions: who still needs
 * something (ממתינים להשלמה), who actually submitted the form (הרשמות),
 * and the full history (כל התהליכים). The same rows behind every view.
 */
async function JoiningTab({ projectId, session, query, askKind, audienceNoun, publicUrl }: { projectId: string; session: StaffSession; query: Record<string, string | undefined>; askKind: boolean; audienceNoun: 'ספק' | 'לקוח'; publicUrl: string | null }) {
  const view: JoiningView = (['invitations', 'registrations', 'all'] as const).find((v) => v === query.view) ?? LEGACY_JOINING_VIEWS[query.view ?? ''] ?? 'registrations'
  const [counts, registrations] = await Promise.all([listAudience(session, projectId, { view: 'all', limit: 1 }), registrationCount(projectId, {} as ReturnType<typeof parseProjectReportFilters>)])
  const chips = JOINING_VIEWS.map((v) => ({ ...v, count: v.key === 'invitations' ? counts.counts.invitations : v.key === 'registrations' ? registrations : counts.counts.all }))
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="תצוגות" className="grid gap-2 sm:grid-cols-3">
        {chips.map((v) => (
          <Link key={v.key} href={`/projects/${projectId}?tab=joining&view=${v.key}`} aria-current={view === v.key ? 'page' : undefined} className={`flex min-h-16 flex-col justify-center rounded-xl border-2 px-4 py-2 transition ${view === v.key ? 'border-brand bg-blue-50' : 'border-line bg-surface hover:border-brand'}`}>
            <span className="flex items-center justify-between gap-2 text-base font-semibold text-fg">
              {v.label}
              <span className={`rounded-full px-2 text-sm ${view === v.key ? 'bg-brand text-white' : 'bg-bg text-muted'}`}>{v.count}</span>
            </span>
            <span className="text-xs text-muted">{v.blurb}</span>
          </Link>
        ))}
      </nav>
      <div>
        <TableExport definition={joiningExport(projectId, view)} />
        {view === 'registrations' ? (
          <RegistrationsTab projectId={projectId} query={query} session={session} audienceNoun={audienceNoun} publicUrl={publicUrl} />
        ) : (
          <PeopleView projectId={projectId} session={session} query={query} askKind={askKind} view={view} />
        )}
      </div>
    </div>
  )
}


/**
 * What each of the three views asks of the people list, as a report:
 * "הזמנות ומעקב" is our own outreach that has not been signed yet,
 * "הרשמות" is everyone who actually submitted the form, and
 * "כל התהליכים" is all of them — the same three questions the chips ask.
 */
function joiningExport(projectId: string, view: JoiningView): ReportDefinition {
  const columns = ['name', 'phone', 'email', 'source', 'process_status', 'progress_stage', 'invited_by_name', 'assignee_name', 'follow_up_at', 'signed_at', 'last_activity_at', 'created_at']
  const clauses: ReportDefinition['clauses'] = [inCampaign(projectId)]
  if (view === 'invitations') {
    clauses.push({ any: [{ field: 'invited_by_us', op: 'is', value: true }] })
    clauses.push({ any: [{ field: 'process_status', op: 'not_one_of', value: ['signed'] }] })
  }
  if (view === 'registrations') clauses.push({ any: [{ field: 'submitted', op: 'is', value: true }] })
  return { entity: 'people', clauses, columns, sort: { field: 'last_activity_at', dir: 'desc' } }
}

async function PeopleView({ projectId, session, query, askKind, view }: { projectId: string; session: StaffSession; query: Record<string, string | undefined>; askKind: boolean; view: 'invitations' | 'all' }) {
  const [audience, due] = await Promise.all([
    listAudience(session, projectId, { view, q: query.q, followUpDue: query.due === '1' }),
    listAudience(session, projectId, { followUpDue: true, limit: 200 }),
  ])
  return <AudienceTable projectId={projectId} rows={audience.rows} counts={audience.counts} view={view} q={query.q ?? ''} askKind={askKind} dueToday={query.due === '1' ? 0 : due.total} hideViews extraParams={{ view }} />
}

/**
 * הקמת מוצרים באתר — the signed suppliers and where their site setup stands.
 * Rows come from the report engine's tasks entity (one row per task, the
 * campaign's kind), so the tab, the reports and the exports agree.
 */
async function SetupTab({ projectId, session, query }: { projectId: string; session: StaffSession; query: Record<string, string | undefined> }) {
  const status = (['pending', 'in_progress', 'done', 'not_needed'] as const).find((s) => s === query.status) ?? 'all'
  const clauses: ReportDefinition['clauses'] = [inCampaign(projectId), { any: [{ field: 'kind', op: 'is', value: 'site_product' }] }]
  if (status !== 'all') clauses.push({ any: [{ field: 'status', op: 'is', value: status }] })
  const [report, counts] = await Promise.all([
    runReport(session, { entity: 'tasks', clauses, columns: ['company', 'contact_name', 'contact_phone', 'signed_at', 'status', 'assignee', 'assignee_name', 'due_at', 'link', 'note'], sort: { field: 'signed_at', dir: 'desc' }, page: 1, pageSize: 100 }),
    taskCounts(session, projectId),
  ])
  const team = await getDb().select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.organizationId, [session.organizationId]))
  const rows: SetupRow[] = report.rows.map((r) => ({
    taskId: r.id,
    leadId: r.links.lead ?? null,
    companyId: r.links.company ?? null,
    agreementId: r.links.agreement ?? null,
    name: String(r.cells.company ?? '—'),
    contactName: (r.cells.contact_name as string | null) ?? null,
    contactPhone: (r.cells.contact_phone as string | null) ?? null,
    signedAt: (r.cells.signed_at as string | null) ?? null,
    status: String(r.cells.status ?? 'pending'),
    assigneeUserId: null,
    assigneeName: (r.cells.assignee as string | null) ?? (r.cells.assignee_name as string | null) ?? null,
    dueAt: (r.cells.due_at as string | null) ?? null,
    link: (r.cells.link as string | null) ?? null,
    note: (r.cells.note as string | null) ?? null,
  }))
  return (
    <>
      {/* The file is the query above it, columns included. */}
      <TableExport definition={{ entity: 'tasks', clauses, columns: ['company', 'contact_name', 'contact_phone', 'signed_at', 'status', 'assignee_name', 'due_at', 'link', 'note'], sort: { field: 'signed_at', dir: 'desc' } }} />
      <SetupTable projectId={projectId} rows={rows} counts={counts} status={status} team={team.map((u) => ({ id: u.id, name: u.name || u.email }))} />
    </>
  )
}

/** קהל — suppliers and customers already in the system, attached to the campaign. */
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


/**
 * The agreements tab as a report: the campaign's documents, and whichever of
 * the screen's filters is on — "דורש טיפול" among them, because the engine
 * computes it the same way the list does rather than approximating it.
 */
function agreementsExport(projectId: string, filter?: 'attention' | 'signed' | 'pending' | 'expired' | 'canceled'): ReportDefinition {
  const clauses: ReportDefinition['clauses'] = [inCampaign(projectId)]
  if (filter === 'attention') clauses.push({ any: [{ field: 'attention', op: 'is', value: true }] })
  if (filter === 'signed') clauses.push({ any: [{ field: 'status', op: 'one_of', value: ['signed'] }] })
  if (filter === 'pending') clauses.push({ any: [{ field: 'status', op: 'one_of', value: ['sent', 'viewed'] }] })
  if (filter === 'expired') clauses.push({ any: [{ field: 'status', op: 'one_of', value: ['expired'] }] })
  if (filter === 'canceled') clauses.push({ any: [{ field: 'status', op: 'one_of', value: ['canceled', 'declined'] }] })
  return {
    entity: 'agreements',
    clauses,
    columns: ['title', 'company', 'recipient_name', 'recipient_phone', 'recipient_email', 'status', 'attention_reason', 'sent_at', 'completed_at', 'expires_at', 'owner_name', 'last_send_result'],
    sort: { field: 'created_at', dir: 'desc' },
  }
}

async function AgreementsTab({
  projectId,
  session,
  filter,
}: {
  projectId: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
  filter?: string
}) {
  const known = ['attention', 'signed', 'pending', 'expired', 'canceled'] as const
  const chosen = known.find((f) => f === filter)
  const result = await listDocuments(session, { groupId: projectId, pageSize: 100, ...(chosen ? { filter: chosen } : {}) })
  if (result.items.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-base font-semibold text-fg">עדיין לא נשלחו הסכמים</p>
        <p className="mt-2 text-sm text-muted">שולחים הסכם לספקים ולקוחות מתוך הקהל, או קישור אישי מתוך הזמנות ומעקב.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href={`/projects/${projectId}?tab=audience`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-5 text-base font-semibold text-white hover:opacity-90">
            לקהל הקמפיין
          </Link>
          <Link href={`/projects/${projectId}?tab=invitations`} className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 text-base font-medium text-fg hover:border-brand">
            שליחת הזמנה אישית
          </Link>
        </div>
      </div>
    )
  }
  return (
    <>
      <TableExport definition={agreementsExport(projectId, chosen)} />
      <DocumentsTable documents={result.items} now={result.now} isAdmin={session.isAdmin} />
    </>
  )
}

async function ReportsTab({
  projectId,
  query,
  session,
}: {
  projectId: string
  query: Record<string, string | undefined>
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
}) {
  const filters = parseProjectReportFilters({ from: query.from, to: query.to, status: query.status, source: query.source, range: query.range })
  const report = await projectReport(session, projectId, filters, 200)
  const params = new URLSearchParams()
  for (const key of ['from', 'to', 'status', 'source', 'range'] as const) if (query[key]) params.set(key, query[key]!)

  return (

    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/reports?tab=builder&d=${Buffer.from(JSON.stringify({ entity: 'people', clauses: [{ any: [{ field: 'campaign', op: 'one_of', value: [projectId] }] }], columns: [], sort: null }), 'utf8').toString('base64url')}`} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
          פתח במחולל הדוחות
        </Link>
        <span className="text-xs text-muted">לבחור תנאים ועמודות, לשמור דוח ולייצא לאקסל.</span>
      </div>
    <ProjectReportView
      projectId={projectId}
      report={serializeReport(report)}
      values={{ from: query.from, to: query.to, status: query.status, source: query.source, range: query.range }}
      exportHref={`/api/projects/${projectId}/report/export?${params}`}
    />
    </>
  )
}

/** Dates as ISO strings: the report screen is a client component. */
function serializeReport(report: ProjectReport): ProjectReportData {
  return { ...report, trafficSince: report.trafficSince?.toISOString() ?? null, registrations: serializeRows(report.registrations) }
}

function serializeRows(rows: RegistrationRow[]): ProjectReportData['registrations'] {
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    agreement: r.agreement ? { ...r.agreement, sentAt: r.agreement.sentAt?.toISOString() ?? null, completedAt: r.agreement.completedAt?.toISOString() ?? null } : null,
  }))
}

/**
 * "הרשמות": everyone who came through the public door, at once — the same
 * table the report uses, with the drawer and the actions. A registration a
 * person must still approve is one row among them, marked "דורש טיפול";
 * there is no separate idea of a lead in the campaign's language.
 */
async function RegistrationsTab({
  projectId,
  query,
  session,
  audienceNoun,
  publicUrl,
}: {
  projectId: string
  query: Record<string, string | undefined>
  session: StaffSession
  audienceNoun: 'ספק' | 'לקוח'
  publicUrl: string | null
}) {
  const filters = parseProjectReportFilters({ status: query.status, q: query.q })
  const [rows, total, attention] = await Promise.all([
    registrationRows(projectId, filters, 200),
    registrationCount(projectId, filters),
    registrationCount(projectId, { status: 'attention' }),
  ])
  void session
  const field = 'min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand'
  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={`/projects/${projectId}`} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="joining" />
        <input type="hidden" name="view" value="registrations" />
        <input type="search" name="q" defaultValue={query.q ?? ''} placeholder="חיפוש לפי עסק, איש קשר, ח.פ., טלפון או אימייל" aria-label="חיפוש בהרשמות" className={`${field} min-w-0 flex-1`} />
        <select name="status" defaultValue={query.status ?? ''} aria-label="סטטוס" className={field}>
          <option value="">כל ההרשמות</option>
          {attention > 0 ? <option value="attention">דורש טיפול ({attention})</option> : null}
          <option value="registered">נרשמו</option>
          <option value="pending">ממתינים לחתימה</option>
          <option value="signed">נחתמו</option>
          <option value="expired">פג תוקף</option>
          <option value="failed">נכשלו / נדחו</option>
        </select>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
          הצגה
        </button>
      </form>
      {attention > 0 && query.status !== 'attention' ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {attention === 1 ? 'הרשמה אחת דורשת טיפול' : `${attention} הרשמות דורשות טיפול`} —{' '}
          <Link href={`/projects/${projectId}?tab=joining&view=registrations&status=attention`} className="underline">
            הצגה
          </Link>
        </p>
      ) : null}
      <RegistrationsTable rows={serializeRows(rows)} total={total} projectId={projectId} title="הרשמות" audienceNoun={audienceNoun} publicUrl={publicUrl} />
    </div>
  )
}

/** Dates as ISO strings: the settings screen is a client component. */
async function publicSlugView(session: StaffSession, id: string) {
  const settings = await getPublicSlugSettings(session, id)
  return { current: settings.current, history: settings.history.map((h) => ({ slug: h.slug, replacedAt: h.replacedAt?.toISOString() ?? null })) }
}

/** The bound agreement as the settings card shows it; null when none or gone. */
async function activeAgreement(session: StaffSession, templateId: string | null) {
  if (!templateId) return null
  try {
    const template = await authorizeTemplateAccess(session, templateId)
    const fields = Array.isArray(template.fields) ? (template.fields as PlacedField[]) : []
    const roles = templateRoles(fields)
    return { id: template.id, name: template.name, fieldCount: fields.length, readyCount: roles.length, missing: missingRoles(roles) }
  } catch {
    return null
  }
}

/** The public address of a public campaign, for the overview's "פתח עמוד". */
async function publicAddress(session: StaffSession, id: string): Promise<string | null> {
  const [landing, slug] = await Promise.all([getLandingSettings(session, id), getPublicSlugSettings(session, id)])
  if (slug.current) return `${publicBaseUrl()}/${slug.current}`
  return landing.url
}
