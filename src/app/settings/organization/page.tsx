import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { BrandKitForm } from '@/components/settings/BrandKitForm'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { getSession } from '@/server/auth/session'
import { getOrganizationProfile } from '@/server/organization/profile'

/**
 * The organization's details and brand — the source every document draws on.
 */
export default async function OrganizationSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  // Company details are what a counterparty relies on; editing is admin work.
  if (!session.isAdmin) redirect('/documents')

  const profile = await getOrganizationProfile(session)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">פרטי הארגון ומיתוג</h1>
      <p className="mt-1 text-sm text-muted">
        הפרטים שמופיעים על המסמכים שאתם שולחים, והצבעים שבהם XTRA AI מעצב אותם.
      </p>
      <SettingsNav />
      <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <BrandKitForm profile={profile} />
      </div>
    </AppShell>
  )
}
