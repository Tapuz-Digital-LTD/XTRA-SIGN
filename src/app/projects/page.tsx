import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { NewCampaignWizard } from '@/components/projects/NewCampaignWizard'
import { ProjectsList } from '@/components/projects/ProjectsList'
import { ProjectsSearch } from '@/components/projects/ProjectsSearch'
import { isCampaignKind } from '@/lib/campaigns'
import { getSession } from '@/server/auth/session'
import { listProjects } from '@/server/groups/groups'
import { findSelfServiceProjectBySkin } from '@/server/projects/self-service'
import { listTemplates } from '@/server/templates/templates'
import { listUsers } from '@/server/users/users'

/**
 * Campaigns: the business envelope around a public page, a list of people,
 * distributions, agreements and their signatures. A plain list with two
 * kinds, and a short wizard to start one.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; view?: string; q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const view = params.view ?? 'all'
  const archived = view === 'archive'
  const campaignKind = isCampaignKind(view) ? view : undefined
  const search = params.q ?? ''
  const [projects, templates, owners, bound] = await Promise.all([
    listProjects(session, { archived, search, campaignKind }),
    listTemplates(session),
    session.isAdmin ? listUsers(session) : Promise.resolve([]),
    findSelfServiceProjectBySkin('tourism-2026'),
  ])

  const tabs = [
    { key: 'all', href: '/projects', label: 'הכול' },
    { key: 'public', href: '/projects?view=public', label: 'קמפיינים ציבוריים' },
    { key: 'signature', href: '/projects?view=signature', label: 'קמפייני חתימות' },
    { key: 'archive', href: '/projects?view=archive', label: 'ארכיון' },
  ]

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">קמפיינים</h1>
          <p className="mt-1 text-sm text-muted">פעילות עם קהל, הפצות, הסכמים וחתימות — ציבורית או מול אנשים שכבר יש לכם.</p>
        </div>
        <NewCampaignWizard
          owners={owners.filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, email: u.email }))}
          templates={templates.map((t) => ({ id: t.id, name: t.name }))}
          currentUserId={session.userId}
          autoOpen={params.new === '1'}
          customPageBound={Boolean(bound)}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-line pb-0">
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="סינון קמפיינים">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={view === tab.key ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition ${
                view === tab.key ? 'border-brand font-semibold text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto mb-2 flex min-w-0 flex-1 justify-end sm:flex-none">
          <ProjectsSearch key={search} search={search} archived={archived} />
        </div>
      </div>

      <div className="mt-5">
        {projects.length === 0 ? (
          search.trim() ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">לא נמצאו קמפיינים מתאימים. נסו חיפוש אחר.</p>
          ) : archived ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">אין קמפיינים בארכיון.</p>
          ) : (
            <EmptyState
              title="עדיין אין קמפיינים"
              description="קמפיין ציבורי מפרסם פעילות ואוסף הרשמות; קמפיין חתימות שולח הסכמים לאנשים שכבר יש לכם. שניהם יכולים להפיץ SMS ואימייל."
              actionIcon="+"
              actionLabel="קמפיין חדש"
              actionHref="/projects?new=1"
            />
          )
        ) : (
          <ProjectsList
            isAdmin={session.isAdmin}
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              campaignKind: p.campaignKind,
              companyCount: p.companyCount,
              registrations: p.registrations,
              signed: p.signed,
              pending: p.pending,
              lastActivityAt: p.lastActivityAt ? p.lastActivityAt.toISOString() : null,
              startsAt: p.startsAt?.toISOString() ?? null,
              endsAt: p.endsAt?.toISOString() ?? null,
              archived,
            }))}
          />
        )}
      </div>
    </AppShell>
  )
}
