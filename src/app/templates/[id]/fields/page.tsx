import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { FieldEditor } from '@/components/editor/FieldEditor'
import { ForbiddenError, getSession } from '@/server/auth/session'
import { templateLayout } from '@/server/templates/templates'

/**
 * A template's boxes, on the template's own pages.
 *
 * The same editor a document uses, pointed at the template's routes: no
 * recipient, no sending — a template is signed by nobody. Reached from the
 * project's agreement card ("הגדרת שדות"), and from the replacement walk
 * when a PDF arrives with no boxes of its own.
 */
export default async function TemplateFieldsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const [{ id }, query] = await Promise.all([params, searchParams])

  let layout
  try {
    layout = await templateLayout(session, id)
  } catch (error) {
    if (error instanceof ForbiddenError) notFound()
    throw error
  }
  // Only a place inside the app: a "back" that leaves the site is not one.
  const back = query.back && /^\/(?!\/)[\w\-/?=&%.]*$/.test(query.back) ? query.back : '/projects'

  if (!layout.ok || layout.pages.length === 0) {
    return (
      <AppShell>
        <h1 className="text-2xl font-bold tracking-tight text-fg">הגדרת שדות</h1>
        <p
          role="status"
          className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted"
        >
          {layout.ok ? 'לא הצלחנו להכין תצוגה של ההסכם, ולכן לא ניתן להציב שדות.' : layout.message}
        </p>
        <div className="mt-4 text-center">
          <Link href={back} className="text-sm text-brand underline">
            חזרה
          </Link>
        </div>
      </AppShell>
    )
  }

  return (
    <FieldEditor
      documentId={id}
      title={layout.name}
      pages={layout.pages}
      initialFields={layout.fields}
      initialRecipient={null}
      target={{
        fieldsUrl: `/api/templates/${id}/fields`,
        fileUrl: `/api/templates/${id}/file`,
        backHref: back,
        backLabel: 'חזרה לפרויקט',
      }}
    />
  )
}
