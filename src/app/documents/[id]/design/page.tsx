import { redirect } from 'next/navigation'

/**
 * The canvas editor left the product. A document designed with it stays
 * readable exactly as rendered; its page is the place to work with it.
 */
export default async function EditDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/documents/${id}`)
}
