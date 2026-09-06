import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { EmailPreview } from '@/components/settings/EmailPreview'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { getSession } from '@/server/auth/session'
import { MAIL_TEMPLATES } from '@/server/mail/catalog'

/** Every email the system sends, seen before anyone else sees it. */
export default async function EmailTemplatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.isAdmin) redirect('/agreements')

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">תבניות מייל</h1>
      <p className="mt-1 text-sm text-muted">כך נראים המיילים שהמערכת שולחת, עם נתוני דוגמה. אפשר לשלוח כל אחד מהם לכתובת שלכם לבדיקה.</p>
      <SettingsNav />
      <div className="mt-4">
        <EmailPreview templates={MAIL_TEMPLATES} />
      </div>
    </AppShell>
  )
}
