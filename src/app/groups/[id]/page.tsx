import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { GroupWorkspace } from '@/components/groups/GroupWorkspace'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { authorizeGroup, listGroupCompanies } from '@/server/groups/groups'
import { listBatches } from '@/server/groups/bulk-send'
import { listTemplates } from '@/server/templates/templates'

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const { q } = await searchParams

  let group
  try {
    group = await authorizeGroup(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }

  const [companies, templates, batches] = await Promise.all([
    listGroupCompanies(session, id, q),
    listTemplates(session),
    listBatches(session, id),
  ])

  // Only templates that could actually be signed.
  const usable = templates
    .filter((t) => t.signatureCount > 0 && t.pageCount !== null)
    .map((t) => ({ id: t.id, name: t.name, signatureCount: t.signatureCount }))

  return (
    <AppShell>
      <div className="mb-4">
        <Link href="/groups" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
          → לכל הקבוצות
        </Link>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">{group.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {companies.length === 1 ? 'חברה אחת' : `${companies.length} חברות`}
            {group.description ? ` · ${group.description}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <GroupWorkspace
          groupId={id}
          groupName={group.name}
          companies={companies}
          templates={usable}
          search={q ?? ''}
        />
      </div>

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
    </AppShell>
  )
}
