import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { NewGroupButton } from '@/components/groups/NewGroupButton'
import { getSession } from '@/server/auth/session'
import { listGroups } from '@/server/groups/groups'

/**
 * Groups: a way to work with many companies at once.
 *
 * A group is a list somebody decided on — a campaign, a season, a project — not
 * a saved search, so it does not change under you between one send and the next.
 */
export default async function GroupsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const groups = await listGroups(session)

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">קבוצות</h1>
          <p className="mt-1 text-sm text-muted">
            רשימות של ספקים ולקוחות לעבודה משותפת — קמפיין, עונה או פרויקט. חברה יכולה להשתייך לכמה קבוצות.
          </p>
        </div>
        <NewGroupButton />
      </div>

      <div className="mt-6">
        {groups.length === 0 ? (
          <EmptyState
            title="עדיין אין קבוצות"
            description="קבוצה היא רשימה של חברות שאפשר לשלוח אליהן הסכם יחד — למשל ״ספקי פסח״ או ״משרד התיירות 2026״."
            actionIcon="+"
            actionLabel="קבוצה חדשה"
            actionHref="/groups?new=1"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex min-h-28 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand hover:shadow-sm"
                >
                  <span>
                    <span className="block font-semibold text-fg">{group.name}</span>
                    {group.description ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-muted">{group.description}</span>
                    ) : null}
                  </span>
                  <span className="mt-3 text-sm text-muted">
                    {group.companyCount === 0
                      ? 'אין חברות עדיין'
                      : group.companyCount === 1
                        ? 'חברה אחת'
                        : `${group.companyCount} חברות`}
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
