import { redirect } from 'next/navigation'
import { getSession } from '@/server/auth/session'

/** Settings is a hallway: each role is sent to the first room it may enter. */
export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  // Both settings screens are admin-only; a non-admin lands on the documents
  // list rather than on a page that would immediately bounce them again.
  redirect(session.isAdmin ? '/settings/organization' : '/documents')
}
