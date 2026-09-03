import { redirect } from 'next/navigation'

/**
 * The list moved to /agreements; old links and bookmarks keep working.
 * Document detail pages stay under /documents/[id].
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
  }
  redirect(`/agreements${query.toString() ? `?${query}` : ''}`)
}
