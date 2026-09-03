import { redirect } from 'next/navigation'

/** Groups became Projects; old links keep working. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/projects/${id}`)
}
