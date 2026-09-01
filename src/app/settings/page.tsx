import { redirect } from 'next/navigation'
import { getSession } from '@/server/auth/session'

/**
 * Settings has exactly one screen today, so this is a hallway, not a room.
 * When a second settings screen exists, this becomes the place that lists them.
 */
export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  // The users screen is admin-only and sends non-admins to the documents list,
  // so routing everyone there gives each role the right landing.
  redirect('/settings/users')
}
