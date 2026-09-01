/**
 * The app's Content-Security-Policy, in one place.
 *
 * It lives here rather than inline in `next.config.ts` so the rules can be
 * asserted by tests. A CSP is invisible until it silently kills a request in
 * production — the one failure mode that never shows up in development, where
 * the same request is same-origin.
 */

/**
 * Where the SDK sends a presigned PUT. Mirrors `getApiUrl` in `@vercel/blob`:
 * the API base, overridable through the same two variables the SDK reads.
 *
 * NOT the store host. A presigned *download* is
 * `https://<storeId>.private.blob.vercel-storage.com/<pathname>`, but a
 * presigned *upload* is `https://vercel.com/api/blob/?pathname=…` — the two
 * operations go to different origins, and only the upload is made by page
 * script. (Downloads are `<a href>` navigations to a route that redirects to
 * the signed URL, and a navigation is not governed by `connect-src`.)
 */
const DEFAULT_BLOB_API_URL = 'https://vercel.com/api/blob'

export function blobApiOrigin(): string {
  const configured =
    process.env.VERCEL_BLOB_API_URL || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL
  try {
    return new URL(configured || DEFAULT_BLOB_API_URL).origin
  } catch {
    return new URL(DEFAULT_BLOB_API_URL).origin
  }
}

/**
 * Whether a presigned upload URL is one the browser is actually allowed to
 * reach under the policy below.
 *
 * Called on the server at the moment the URL is minted, so that a change in
 * where the SDK sends uploads fails loudly here — with the offending origin
 * named — instead of becoming a dead PUT in someone's browser. The browser
 * PUTs the chosen file straight to that origin; `connect-src 'self'` blocks
 * such a request before a single byte leaves the page, with no status code
 * and no response to inspect. That was the original bug.
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

  return parsed.protocol === 'https:' && parsed.origin === blobApiOrigin()
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
 * `connect-src` is `'self'` plus the Blob API origin and nothing else. The
 * browser still never talks to InforU or to any other third party: every
 * outbound call but the upload PUT goes through the server, which is what
 * keeps credentials off the client. The upload is the one exception, and it
 * carries no credential of ours — the URL is signed, scoped to a single
 * pathname, limited to `put`, and expires in two minutes.
 */
export function buildCsp(options: { isProd: boolean }): string {
  const { isProd } = options

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${blobApiOrigin()}`,
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
