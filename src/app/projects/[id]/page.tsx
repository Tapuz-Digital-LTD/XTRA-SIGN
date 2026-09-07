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
import { describeCampaign, entryLabel, goalLabel, isCampaignKind, LEGACY_TABS, TAB_INTROS, TAB_LABELS, tabsFor, type CampaignKind, type CampaignTab } from '@/lib/campaigns'
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
  searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string; status?: string; source?: string; range?: string; setup?: string; new?: string; section?: string; returnTo?: string }>
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
  const TABS = tabsFor(shape.entry)
  const requested = LEGACY_TABS[query.tab ?? ''] ?? query.tab
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
        <TabPicker current={tab} options={TABS.map((key) => ({ key, label: TAB_LABELS[key], href: href(key), badge: key === 'registrations' ? newLeadCount : undefined }))} />
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
            {key === 'registrations' && newLeadCount > 0 ? (
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
        {tab === 'overview' ? <CampaignOverview project={{ id, name: project.name, campaignKind, publicUrl: campaignKind === 'public' ? await publicAddress(session, id) : null }} companies={companies} leads={leads} /> : null}
        {tab === 'audience' ? <SuppliersTab projectId={id} projectName={project.name} companies={companies} search={query.q ?? ''} session={session} /> : null}
        {tab === 'invitations' ? <InvitationsTab projectId={id} session={session} query={query} askKind={project.kind === null} /> : null}
        {tab === 'distributions' ? <DistributionsTab projectId={id} campaignKind={campaignKind} publicUrl={campaignKind === 'public' ? await publicAddress(session, id) : null} isAdmin={session.isAdmin} openNew={query.new === '1'} /> : null}
        {tab === 'registrations' ? <RegistrationsTab projectId={id} query={query} session={session} audienceNoun={project.kind === 'customer' ? 'לקוח' : 'ספק'} publicUrl={await publicAddress(session, id)} /> : null}
        {tab === 'agreements' ? <AgreementsTab projectId={id} session={session} /> : null}
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

/** הזמנות ומעקב — the people we reached by name and phone, from the send to the signature. */
async function InvitationsTab({
  projectId,
  session,
  query,
  askKind,
}: {
  projectId: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
  query: Record<string, string | undefined>
  askKind: boolean
}) {
  const view: AudienceView = (['all', 'invited', 'waiting', 'registered', 'signed'] as const).includes(query.view as AudienceView) ? (query.view as AudienceView) : 'all'
  const [audience, due] = await Promise.all([
    listAudience(session, projectId, { view, q: query.q, followUpDue: query.due === '1' }),
    listAudience(session, projectId, { followUpDue: true, limit: 200 }),
  ])
  return <AudienceTable projectId={projectId} rows={audience.rows} counts={audience.counts} view={view} q={query.q ?? ''} askKind={askKind} dueToday={query.due === '1' ? 0 : due.total} />
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
  return <DocumentsTable documents={result.items} now={result.now} isAdmin={session.isAdmin} />
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
    <ProjectReportView
      projectId={projectId}
      report={serializeReport(report)}
      values={{ from: query.from, to: query.to, status: query.status, source: query.source, range: query.range }}
      exportHref={`/api/projects/${projectId}/report/export?${params}`}
    />
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
      {total === 0 && !query.q && !query.status ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-fg">עדיין אין הרשמות</p>
          <p className="mt-2 text-sm text-muted">כאשר אנשים ימלאו את טופס הקמפיין, ההרשמות שלהם יופיעו כאן.</p>
          {publicUrl ? (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 text-base font-semibold text-white hover:opacity-90">
              צפייה בעמוד הקמפיין
            </a>
          ) : null}
        </div>
      ) : null}
      <form method="get" action={`/projects/${projectId}`} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="registrations" />
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
          <Link href={`/projects/${projectId}?tab=registrations&status=attention`} className="underline">
            הצגה
          </Link>
        </p>
      ) : null}
      <RegistrationsTable rows={serializeRows(rows)} total={total} projectId={projectId} title="הרשמות" audienceNoun={audienceNoun} />
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
