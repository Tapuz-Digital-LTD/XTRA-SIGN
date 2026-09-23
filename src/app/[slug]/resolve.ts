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

/**
 * What travels from the call to the explainer to the joining page on the
 * link.
 *
 * `xs_inv` is the personal invitation the visitor arrived through, and it
 * matters more than any of the rest: the joining form reads these off its own
 * address, so a key dropped on the way is a registration that cannot be tied
 * back to the invitation that produced it — a second row for one person, and
 * an invitation left reading "הוזמן" after they signed.
 */
export const CARRIED_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'xs_inv'] as const

/** `/<slug>/<page>` with the carried keys of this address on it, and nothing else. */
export function carriedHref(slug: string, page: string, query: SearchParams): string {
  const carried = new URLSearchParams()
  for (const key of CARRIED_KEYS) {
    const value = query[key]
    if (typeof value === 'string' && value.trim()) carried.set(key, value.trim().slice(0, 200))
  }
  return carried.size > 0 ? `/${slug}/${page}?${carried}` : `/${slug}/${page}`
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
