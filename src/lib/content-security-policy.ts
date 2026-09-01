/**
 * The app's Content-Security-Policy, in one place.
 *
 * It lives here rather than inline in `next.config.ts` so the rules can be
 * asserted by tests. A CSP is invisible until it silently kills a request in
 * production — the one failure mode that never shows up in development, where
 * the same request is same-origin.
 */

/**
 * The host a presigned Blob upload lands on.
 *
 * `@vercel/blob` builds a presigned URL as
 * `https://<storeId>.<access>.blob.vercel-storage.com/<pathname>`, and every
 * object this app writes uses `access: 'private'`.
 *
 * This MUST be reachable from `connect-src`. The browser PUTs the chosen file
 * straight to that host — the whole point of presigning is that a 25MB upload
 * never crosses a function — and `connect-src 'self'` blocks that request
 * before a single byte leaves the page. There is no status code and no
 * response to inspect: `fetch` simply rejects, which the upload UI can only
 * report as "check your internet connection". That was the bug.
 */
const BLOB_UPLOAD_HOST_SUFFIX = '.private.blob.vercel-storage.com'

export const BLOB_UPLOAD_ORIGIN = `https://*${BLOB_UPLOAD_HOST_SUFFIX}`

/**
 * Whether a presigned upload URL is one the browser is actually allowed to
 * reach under the policy below.
 *
 * Called on the server, at the moment the URL is minted, so that a change in
 * how Blob shapes its URLs fails loudly here — with the offending origin named
 * — instead of becoming a dead PUT in someone's browser.
 *
 * A relative URL is the development stand-in route on our own origin, which
 * `'self'` already covers.
 */
export function isConnectableUploadUrl(url: string): boolean {
  if (url.startsWith('/')) return true

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.endsWith(BLOB_UPLOAD_HOST_SUFFIX) &&
    // `*.` requires at least one label in front of the suffix; a bare
    // "private.blob.vercel-storage.com" would not match the CSP source.
    parsed.hostname.length > BLOB_UPLOAD_HOST_SUFFIX.length
  )
}

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` on styles is Tailwind's inlined critical CSS and Next's
 * style injection; removing it needs a nonce plumbed through every render, and
 * an injected stylesheet is a far smaller problem than an injected script.
 *
 * Scripts get no `'unsafe-eval'` in production. Development needs it for React
 * Refresh, which is exactly the sort of gap that should not exist in the build
 * that faces the internet.
 *
 * `img-src 'self' data: blob:` — page previews come from our own routes, and
 * the signature pad produces a data/blob URL before it is uploaded.
 *
 * `connect-src` is `'self'` plus the Blob upload host and nothing else. The
 * browser still never talks to InforU or to any other third party: every
 * outbound call but the upload PUT goes through the server, which is what
 * keeps credentials off the client. The upload is the one exception, and it
 * carries no credential of ours — the URL is signed, scoped to a single
 * pathname, limited to `put`, and expires in two minutes.
 *
 * Note that downloads do NOT need an entry here: those are `<a href>`
 * navigations to a route that redirects to a signed URL, and a navigation is
 * not governed by `connect-src`.
 */
export function buildCsp(options: { isProd: boolean }): string {
  const { isProd } = options

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${BLOB_UPLOAD_ORIGIN}`,
    // pdf.js runs its parser in a Web Worker, which Next serves from a blob: URL.
    // Without this the preview silently fails to render.
    "worker-src 'self' blob:",
    // Storage is private and signed download URLs are followed by a redirect the
    // browser makes itself, so no third-party origin needs to be submittable to.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}
