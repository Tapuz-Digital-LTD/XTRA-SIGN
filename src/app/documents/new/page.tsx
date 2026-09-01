import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { UploadCard } from '@/components/UploadCard'
import { getSession } from '@/server/auth/session'

export default async function NewDocumentPage() {
  if (!(await getSession())) redirect('/login')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">איך תרצו להתחיל?</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <UploadCard />

        {/* Not built yet, and said so rather than shown as a working choice. */}
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 opacity-60">
          <h2 className="text-base font-semibold text-fg">יצירת טופס</h2>
          <p className="mt-1 text-sm text-muted">יצירת מסמך חדש ישירות במערכת</p>
          <p className="mt-4 text-xs text-muted">בקרוב</p>
        </div>
      </div>
    </AppShell>
  )
}
