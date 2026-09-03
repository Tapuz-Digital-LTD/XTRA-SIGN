import { redirect } from 'next/navigation'

/** The canvas editor left the product: XTRA Sign signs PDFs, it does not design them. */
export default async function NewDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const params = await searchParams
  redirect(params.company ? `/documents/new?company=${params.company}` : '/documents/new')
}
