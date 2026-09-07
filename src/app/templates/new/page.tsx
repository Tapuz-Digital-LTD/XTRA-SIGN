import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { TemplateUploadWizard } from '@/components/templates/TemplateUploadWizard'
import { getSession } from '@/server/auth/session'

/** A new template from a PDF, in four steps; or from a document already in the system. */
export default async function NewTemplatePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  return (
    <AppShell>
      <nav className="text-sm text-muted" aria-label="פירורי לחם">
        <Link href="/templates" className="hover:underline">תבניות</Link> <span aria-hidden="true">›</span> תבנית חדשה
      </nav>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-fg">תבנית חדשה</h1>
      <p className="mt-1 text-sm text-muted">מעלים PDF, מאשרים אילו פרטים ממלאים כל שדה, רואים את התוצאה, ומפעילים.</p>
      <div className="mt-6 max-w-3xl rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <TemplateUploadWizard mode="new" />
      </div>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        דרך נוספת: לפתוח מסמך קיים ולבחור בו &quot;שמירה כתבנית&quot; — <Link href="/documents/new" className="font-medium text-brand hover:underline">מסמך חדש</Link>.
      </p>
    </AppShell>
  )
}
