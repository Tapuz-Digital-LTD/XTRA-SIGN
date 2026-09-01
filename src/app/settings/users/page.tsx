import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { UsersTable } from '@/components/settings/UsersTable'
import { getSession } from '@/server/auth/session'
import { listUsers } from '@/server/users/users'

export default async function UsersPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  // A non-admin has no business knowing this page exists.
  if (!session.isAdmin) redirect('/documents')

  const users = await listUsers(session)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">משתמשים</h1>
      <p className="mt-1 text-sm text-muted">
        משתמשים נוספים למערכת בהזמנה בלבד. כל משתמש מגדיר סיסמה בעצמו.
      </p>

      <div className="mt-6">
        <UsersTable users={users} currentUserId={session.userId} />
      </div>
    </AppShell>
  )
}
