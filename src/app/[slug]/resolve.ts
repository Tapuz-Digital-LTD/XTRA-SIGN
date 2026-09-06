import { notFound, permanentRedirect } from 'next/navigation'
import { findSelfServiceProjectBySlug, type SelfServiceProject } from '@/server/projects/self-service'

/**
 * The project behind a public address, for a campaign page to render.
 *
 * An address the project used to have is answered with a permanent redirect
 * straight to the current one — the rest of the path and every query
 * parameter carried along, so an old flyer link with its UTM tags still
 * lands and still attributes. Never a chain: every alias points at what is
 * current now. An address nobody has is a 404.
 */
export type SearchParams = Record<string, string | string[] | undefined>

export async function campaignProject(slug: string, rest: string, searchParams?: SearchParams): Promise<SelfServiceProject> {
  const found = await findSelfServiceProjectBySlug(slug)
  if (!found) notFound()
  if (found.isAlias) permanentRedirect(`/${found.canonical}${rest}${queryString(searchParams)}`)
  return found.project
}

export function queryString(searchParams?: SearchParams): string {
  if (!searchParams) return ''
  const carried = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') carried.append(key, value)
    else if (Array.isArray(value)) for (const v of value) carried.append(key, v)
  }
  const s = carried.toString()
  return s ? `?${s}` : ''
}
