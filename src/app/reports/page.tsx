import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell } from '@/components/AppShell'
import { ReportBuilder } from '@/components/reports/builder/ReportBuilder'
import { getSession } from '@/server/auth/session'

/**
 * דוחות ומעקב — one screen: מעקב (ready-made views and the team's shared
 * reports) and מחולל דוחות (build your own). Both show results in the same
 * area, with the same actions on the selected rows.
 */
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">דוחות ומעקב</h1>
      <p className="mt-1 text-sm text-muted">מצאו מי דורש טיפול, סננו את הנתונים ובצעו פעולות ישירות.</p>
      <Suspense fallback={<p className="mt-5 text-sm text-muted">טוען…</p>}>
        <ReportBuilder />
      </Suspense>
    </AppShell>
  )
}
