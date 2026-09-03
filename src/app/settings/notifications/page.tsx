import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { NotificationSettingsForm } from '@/components/settings/NotificationSettingsForm'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { getSession } from '@/server/auth/session'
import { getNotificationPrefs } from '@/server/notifications/notifications'

/** Who hears about what, by email. In-app notifications always work. */
export default async function NotificationSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.isAdmin) redirect('/agreements')

  const prefs = await getNotificationPrefs(session.organizationId)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">התראות</h1>
      <p className="mt-1 text-sm text-muted">
        לאן לשלוח אימייל כשמשהו קורה. ההתראות בתוך המערכת (בפעמון) פועלות תמיד.
      </p>
      <SettingsNav />
      <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <NotificationSettingsForm prefs={prefs} />
      </div>
    </AppShell>
  )
}
