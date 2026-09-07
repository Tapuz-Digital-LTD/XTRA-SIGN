import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { SecuritySettingsForm } from '@/components/settings/SecuritySettingsForm'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { getSession } from '@/server/auth/session'
import { getCaptchaAdminView } from '@/server/security/captcha'

/** Admin-only: the protection on the doors strangers use. */
export default async function SecuritySettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.isAdmin) redirect('/agreements')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">אבטחת טפסים והתחברות</h1>
      <p className="mt-1 text-sm text-muted">כאן מפעילים ומכבים את ההגנה מפני רובוטים על הטפסים הציבוריים ועל ההתחברות.</p>
      <SettingsNav />
      <div className="mt-4">
        <SecuritySettingsForm initial={await getCaptchaAdminView(session)} />
      </div>
    </AppShell>
  )
}
