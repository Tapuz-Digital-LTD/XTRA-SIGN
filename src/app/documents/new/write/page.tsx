import { redirect } from 'next/navigation'

/** The in-app writer left the product: documents are prepared elsewhere and arrive as PDFs. */
export default async function NewWritePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const params = await searchParams
  redirect(params.company ? `/documents/new?company=${params.company}` : '/documents/new')
}
