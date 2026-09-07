import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { ScrollRestore } from '@/components/nav/ScrollRestore'
import { TemplateList } from '@/components/TemplateList'
import { getSession } from '@/server/auth/session'
import { listTemplates } from '@/server/templates/templates'

/**
 * A template is a ready PDF plus its field layout — nothing more. Templates are
 * shared by the organization; a new document from one starts with its PDF and
 * its fields already in place.
 */
export default async function TemplatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const templates = await listTemplates(session)

  return (
    <AppShell>
      <ScrollRestore />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-fg">תבניות</h1>
        <Link
          href="/templates/new"
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
        >
          + תבנית חדשה מ-PDF
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">
        תבנית היא PDF עם שדות שממולאים אוטומטית וחתימה. מעלים PDF → מאשרים איזה פרט ממלא כל שדה → רואים
        תצוגה מקדימה → מפעילים. לוחצים על תבנית כדי לצפות בה, לערוך שדות או להחליף את הקובץ.
      </p>

      <div className="mt-6">
        {templates.length === 0 ? (
          <EmptyState
            title="עדיין אין תבניות"
            description="מעלים PDF, מציבים עליו שדות, ובעמוד המסמך לוחצים ״שמירה כתבנית״. מכאן ואילך כל מסמך חדש מהתבנית יתחיל עם השדות במקום."
            actionIcon="+"
            actionLabel="תבנית חדשה מ-PDF"
            actionHref="/templates/new"
          />
        ) : (
          <TemplateList templates={templates} />
        )}
      </div>
    </AppShell>
  )
}
