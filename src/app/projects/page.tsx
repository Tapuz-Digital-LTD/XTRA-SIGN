import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { NewGroupButton } from '@/components/groups/NewGroupButton'
import { ProjectsList } from '@/components/projects/ProjectsList'
import { ProjectsSearch } from '@/components/projects/ProjectsSearch'
import { getSession } from '@/server/auth/session'
import { listProjects } from '@/server/groups/groups'

/**
 * Projects: an activity with its own suppliers, sends and tracking. A plain
 * list, not a dashboard — a project is a collection of suppliers, leads and
 * agreements around one activity, and that is the whole concept.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; view?: string; q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const archived = params.view === 'archive'
  const search = params.q ?? ''
  const projects = await listProjects(session, { archived, search })

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">פרויקטים</h1>
          <p className="mt-1 text-sm text-muted">
            פעילות עם ספקים משלה — הוספה, טופס הצטרפות, שליחה מרוכזת ומעקב.
          </p>
        </div>
        <NewGroupButton autoOpen={params.new === '1'} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-line pb-0">
        <nav className="flex gap-1" aria-label="סינון פרויקטים">
          {(
            [
              { key: false, href: '/projects', label: 'פעילים' },
              { key: true, href: '/projects?view=archive', label: 'ארכיון' },
            ] as const
          ).map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={archived === tab.key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm transition ${
                archived === tab.key ? 'border-brand font-semibold text-fg' : 'border-transparent text-muted hover:text-fg'
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
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
              לא נמצאו פרויקטים מתאימים. נסו חיפוש אחר.
            </p>
          ) : archived ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
              אין פרויקטים בארכיון.
            </p>
          ) : (
            <EmptyState
              title="עדיין אין פרויקטים"
              description="פרויקט הוא פעילות עם רשימת ספקים משלה — למשל ״חודש התיירות 2026״. מוסיפים ספקים, שולחים הסכם ועוקבים מי חתם."
              actionIcon="+"
              actionLabel="פרויקט חדש"
              actionHref="/projects?new=1"
            />
          )
        ) : (
          <ProjectsList
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              companyCount: p.companyCount,
              signed: p.signed,
              pending: p.pending,
              lastActivityAt: p.lastActivityAt ? p.lastActivityAt.toISOString() : null,
              archived,
            }))}
          />
        )}
      </div>
    </AppShell>
  )
}
