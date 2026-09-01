import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { getSession } from '@/server/auth/session'

/**
 * Honest placeholder: templates are in the plan and in the navigation, but not
 * in this version. A named "not yet" beats a 404 that looks like a defect —
 * and beats a mocked screen that pretends to work.
 */
export default async function TemplatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">תבניות</h1>
      <div className="mt-6">
        <EmptyState
          title="תבניות עדיין לא זמינות"
          description="בקרוב יהיה אפשר לשמור מסמך עם השדות שלו כתבנית ולשלוח אותו שוב ושוב בלי להגדיר הכול מחדש. בינתיים אפשר להעלות מסמך חדש ולסדר את השדות ידנית."
          actionHref="/documents/new"
          actionLabel="מסמך חדש"
        />
      </div>
    </AppShell>
  )
}
