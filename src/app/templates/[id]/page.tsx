import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { AppShell } from '@/components/AppShell'
import { BackLink } from '@/components/nav/BackLink'
import { TemplateDetail } from '@/components/templates/TemplateDetail'
import { readReturnTo } from '@/lib/return-to'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { templateLayout } from '@/server/templates/templates'

/** תבניות → תבנית: see it, rename it, edit its fields, replace its PDF, make a document from it. */
export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params
  const returnTo = readReturnTo((await searchParams).returnTo)
  let layout: Awaited<ReturnType<typeof templateLayout>>
  try {
    layout = await templateLayout(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }
  if (!layout.ok) {
    return (
      <AppShell>
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{layout.message}</p>
      </AppShell>
    )
  }
  const usedBy = await getDb()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.organizationId, session.organizationId),
        isNull(schema.groups.deletedAt),
        or(eq(schema.groups.defaultTemplateId, id), sql`${schema.groups.landingConfig}->'selfService'->>'templateId' = ${id}`),
      ),
    )
    .limit(20)

  return (
    <AppShell>
      <BackLink returnTo={returnTo} fallback="/templates" />
      <div>
        <TemplateDetail id={id} name={layout.name} pages={layout.pages} fields={layout.fields as never} isAdmin={session.isAdmin} usedBy={usedBy} />
      </div>
    </AppShell>
  )
}
