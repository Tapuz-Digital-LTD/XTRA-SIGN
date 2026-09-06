/**
 * The rules for a project's public address, shared by the settings screen
 * and the server: what a slug may look like, and which paths it may never
 * take because the application already answers there.
 */

export const SLUG_MIN = 3
export const SLUG_MAX = 60

/**
 * Top-level paths the app itself owns. A dynamic public address at the root
 * would either shadow these or be shadowed by them; either way a campaign
 * must not live there.
 */
export const RESERVED_SLUGS = new Set([
  'api', 'admin', 'sign', 'login', 'logout', 'settings', 'projects', 'documents', 'agreements',
  'templates', 'suppliers', 'customers', 'companies', 'join', 'groups', 'embed', 'public',
  'static', 'assets', 'images', 'fonts', 'health', 'ready', 'cron', 'dev-blob', 'favicon.ico',
  'robots.txt', 'sitemap.xml', 'manifest.json', '_next', 'next', 'vercel', 'www', 'app', 'auth',
  'user', 'users', 'account', 'dashboard', 'new', 'edit', 'preview', 'thanks', 'join', 'tourism',
])

/**
 * What a person typed, as the slug it would become: lower-case, spaces to
 * hyphens, nothing but ASCII letters, digits and hyphens. Hebrew is not
 * turned into anything — a Hebrew address would be percent-encoded in every
 * SMS and QR code, which is uglier than asking for English.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string }

export function validateSlug(raw: string): SlugCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, message: 'יש להזין כתובת.' }
  if (/[^\x20-\x7e]/.test(trimmed)) {
    return { ok: false, message: 'הכתובת יכולה להכיל אותיות אנגליות, ספרות ומקפים בלבד.' }
  }
  const slug = normalizeSlug(trimmed)
  if (slug.length < SLUG_MIN) return { ok: false, message: `הכתובת צריכה להיות באורך ${SLUG_MIN} תווים לפחות.` }
  if (slug.length > SLUG_MAX) return { ok: false, message: `הכתובת יכולה להיות באורך עד ${SLUG_MAX} תווים.` }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, message: 'הכתובת הזו שמורה למערכת. בחרו כתובת אחרת.' }
  return { ok: true, slug }
}
