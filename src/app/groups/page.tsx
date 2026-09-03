import { redirect } from 'next/navigation'

/** Groups became Projects; old links keep working. */
export default async function GroupsPage() {
  redirect('/projects')
}
