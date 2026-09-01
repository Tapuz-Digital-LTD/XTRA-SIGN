import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import { getSession } from '@/server/auth/session'

export default async function DocumentsPage() {
  if (!(await getSession())) redirect('/login')

  // Phase 1 renders the empty state only. The list arrives with the query layer
  // in Phase 2 — shipping a fake list now would make an unbuilt screen look done.
  const documents: never[] = []

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">מסמכים</h1>

      {documents.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="עדיין אין כאן מסמכים"
            description="צרו מסמך ראשון ושלחו אותו לחתימה בכמה צעדים פשוטים."
            actionIcon="+"
            actionLabel="יצירת מסמך"
            actionHref="/documents/new"
          />
        </div>
      ) : null}
    </AppShell>
  )
}
