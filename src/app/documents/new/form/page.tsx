import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DocumentComposer } from '@/components/DocumentComposer'
import { getSession } from '@/server/auth/session'

export default async function ComposeDocumentPage() {
  if (!(await getSession())) redirect('/login')

  return (
    <AppShell>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">כתיבת מסמך</h1>
          <p className="mt-1 text-xs text-muted">
            <span className="font-medium text-fg">1. מסמך</span> → 2. שדות → 3. חותם → 4. שליחה
          </p>
        </div>
        <Link
          href="/documents/new"
          className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          חזרה
        </Link>
      </div>

      <div className="mt-6">
        <DocumentComposer />
      </div>
    </AppShell>
  )
}
