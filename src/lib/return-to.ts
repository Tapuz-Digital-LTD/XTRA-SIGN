/**
 * Where "חזרה" goes.
 *
 * A card — a company, a document, a campaign — is opened from many places: a
 * campaign's audience, a report, a filtered list, the header search. Back must
 * land on that place with its state (source, filters, search, tab, page), so
 * the place travels with the link as `returnTo`: the opening screen's own URL,
 * query string included. It is validated here before it is ever used as a
 * link, and anything that is not a same-origin relative path falls back, so a
 * crafted link cannot send a user off-site. Opened with no `returnTo` (a
 * bookmark, a refresh, a new tab), a card falls back to its list.
 */

const MAX_LENGTH = 600

/** One leading slash, then not another slash or a backslash: a path on this origin, never `//host` or a scheme. */
const RELATIVE_PATH = /^\/(?![/\\])[^\\]*$/

/** Control characters and whitespace: nothing a real in-app URL carries raw. */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

/** `raw` when it is a safe same-origin path, else `fallback`. */
export function safeReturnTo(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback
  if (!RELATIVE_PATH.test(raw) || hasUnsafeChars(raw)) return fallback
  return raw
}

/** A page's `?returnTo=`: the validated path, or null when absent or unsafe. */
export function readReturnTo(raw: unknown): string | null {
  return safeReturnTo(raw, '') || null
}

/** `href` carrying `returnTo` (its other query params kept); `href` itself when there is nothing to carry. */
export function withReturnTo(href: string, returnTo: string | null | undefined): string {
  if (!returnTo) return href
  const [path, query = ''] = href.split('?', 2)
  const params = new URLSearchParams(query)
  params.set('returnTo', returnTo)
  return `${path}?${params}`
}

/** The URL a client component is on, for `usePathname()` + `useSearchParams()`. */
export function currentUrlFor(pathname: string, searchParams: { toString(): string } | null | undefined): string {
  const query = searchParams?.toString() ?? ''
  return query ? `${pathname}?${query}` : pathname
}

const LABELS: [RegExp, string][] = [
  [/^\/projects\/[^/]+/, 'חזרה לקמפיין'],
  [/^\/projects(?:\/|$)/, 'חזרה לקמפיינים'],
  [/^\/suppliers(?:\/|$)/, 'חזרה לספקים'],
  [/^\/customers(?:\/|$)/, 'חזרה ללקוחות'],
  [/^\/tracking(?:\/|$)/, 'חזרה למעקב'],
  [/^\/reports(?:\/|$)/, 'חזרה לדוחות'],
  [/^\/companies\/[^/]+/, 'חזרה לחברה'],
  [/^\/documents\/[^/]+/, 'חזרה להסכם'],
  [/^\/(?:agreements|documents)(?:\/|$)/, 'חזרה להסכמים'],
  [/^\/templates(?:\/|$)/, 'חזרה לתבניות'],
]

/** The back button's label, from where the path leads. */
export function describeReturn(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0]
  if (pathname === '/') return 'חזרה לבית'
  return LABELS.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'חזרה'
}
