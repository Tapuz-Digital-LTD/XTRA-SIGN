import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { TemplateList } from '@/components/TemplateList'
import { CrmTemplateImport } from '@/components/crm/CrmTemplateImport'
import { getSession } from '@/server/auth/session'
import { getCrmProvider } from '@/server/crm/fireberry'
import { listTemplates } from '@/server/templates/templates'

/**
 * Templates are shared by the organization. A new document from one starts
 * with its PDF and its fields already in place.
 */
export default async function TemplatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const templates = await listTemplates(session)

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-fg">תבניות</h1>
        {getCrmProvider().isConfigured() ? <CrmTemplateImport /> : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        מסמך שנשמר עם השדות שלו, כדי לשלוח אותו שוב ושוב בלי לסדר הכול מחדש. שומרים תבנית
        מעמוד המסמך, בלחיצה על &quot;שמירה כתבנית&quot;.
      </p>

      <div className="mt-6">
        {templates.length === 0 ? (
          <EmptyState
            title="עדיין אין תבניות"
            description="העלו או כתבו מסמך, סדרו עליו את השדות, ובעמוד המסמך לחצו על ״שמירה כתבנית״. מכאן ואילך כל מסמך חדש מהתבנית יתחיל עם השדות במקום."
            actionIcon="+"
            actionLabel="מסמך חדש"
            actionHref="/documents/new"
          />
        ) : (
          <TemplateList templates={templates} />
        )}
      </div>
    </AppShell>
  )
}
