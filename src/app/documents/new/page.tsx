import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { UploadCard } from '@/components/UploadCard'
import { getSession } from '@/server/auth/session'
import { countTemplates } from '@/server/templates/templates'

export default async function NewDocumentPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const templateCount = await countTemplates(session)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">איך תרצו להתחיל?</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UploadCard />

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 className="text-base font-semibold text-fg">כתיבת מסמך</h2>
          <p className="mt-1 text-sm text-muted">כתיבת מסמך חדש ישירות במערכת, בלי קובץ</p>
          <Link
            href="/documents/new/form"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            כתיבת מסמך
          </Link>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 className="text-base font-semibold text-fg">מתבנית</h2>
          <p className="mt-1 text-sm text-muted">
            {templateCount === 0
              ? 'עדיין אין תבניות. שומרים מסמך כתבנית מעמוד המסמך.'
              : templateCount === 1
                ? 'תבנית אחת שמורה, עם השדות שלה'
                : `${templateCount} תבניות שמורות, עם השדות שלהן`}
          </p>
          <Link
            href="/templates"
            className={`mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors ${
              templateCount === 0
                ? 'border border-line bg-surface text-fg hover:bg-slate-50'
                : 'bg-brand text-white hover:bg-[var(--color-accent-hover)]'
            }`}
          >
            {templateCount === 0 ? 'לתבניות' : 'בחירת תבנית'}
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
