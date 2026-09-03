import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { NewGroupButton } from '@/components/groups/NewGroupButton'
import { getSession } from '@/server/auth/session'
import { listGroups } from '@/server/groups/groups'

/**
 * Projects: an activity with its own suppliers, sends and tracking — "חודש
 * התיירות 2026". A project is a list somebody decided on, not a saved search,
 * so it does not change under you between one send and the next.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const [projects, params] = await Promise.all([listGroups(session), searchParams])

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">פרויקטים</h1>
          <p className="mt-1 text-sm text-muted">
            פעילות עם ספקים משלה — הוספה ידנית, ייבוא מ-Excel או טופס הצטרפות, שליחה מרוכזת ומעקב.
          </p>
        </div>
        <NewGroupButton autoOpen={params.new === '1'} />
      </div>

      <div className="mt-6">
        {projects.length === 0 ? (
          <EmptyState
            title="עדיין אין פרויקטים"
            description="פרויקט הוא פעילות עם רשימת ספקים משלה — למשל ״חודש התיירות 2026״. מוסיפים ספקים, שולחים הסכם לכולם ועוקבים מי חתם."
            actionIcon="+"
            actionLabel="פרויקט חדש"
            actionHref="/projects?new=1"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex min-h-28 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand hover:shadow-sm"
                >
                  <span>
                    <span className="block font-semibold text-fg">{project.name}</span>
                    {project.description ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-muted">{project.description}</span>
                    ) : null}
                  </span>
                  <span className="mt-3 text-sm text-muted">
                    {project.companyCount === 0
                      ? 'אין ספקים עדיין'
                      : project.companyCount === 1
                        ? 'ספק אחד'
                        : `${project.companyCount} ספקים`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
