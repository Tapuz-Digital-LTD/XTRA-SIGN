/**
 * Showing a document without ever making it public.
 *
 * Two separate paths, because "preview" and "download" have different threat
 * models:
 *
 *  1. THE EDITOR PREVIEW is page images, not the PDF. The field editor needs
 *     fixed pixel geometry anyway to place fields, and a PNG cannot execute.
 *     This removes the whole class of "malicious PDF runs script in the viewer"
 *     rather than mitigating it. Images stream through the app after an
 *     authorization check, so no storage URL is ever handed out.
 *
 *  2. THE INLINE PDF VIEW, for a user who wants to read the real document, is a
 *     short-lived signed URL carrying `ResponseContentDisposition: inline`.
 *     Rendering happens on the STORAGE origin, which is a different origin from
 *     the app — so even a hostile PDF that escapes the viewer sandbox is not
 *     same-origin with the session cookie. Serving those bytes from our own
 *     origin would be strictly worse.
 *
 * In neither case does an object become publicly readable, and neither path
 * accepts a storage key from the caller.
 */

export type PreviewDisposition = 'inline' | 'attachment'

/**
 * Response headers for bytes streamed through the app.
 *
 * `sandbox` in a CSP on a document response neutralises script, plugins, forms
 * and same-origin access for whatever is being served. `no-store` keeps a
 * document out of the shared caches a signed-out user could later reach.
 */
export function previewHeaders(contentType: string, filename?: string): Headers {
  const headers = new Headers()
  headers.set('Content-Type', contentType)
  // `sandbox` with no tokens neutralises script, plugins, forms and same-origin
  // access for whatever is being served. The bytes are consumed by pdf.js in
  // the parent page, not rendered by the browser directly, so nothing here
  // needs to be permitted.
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, no-store, max-age=0')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set(
    'Content-Disposition',
    filename
      ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
      : 'inline',
  )
  return headers
}

/** Page numbers arrive from a URL segment, so they are a claim, not a fact. */
export function parsePageNumber(raw: string, pageCount: number | null): number | null {
  if (!/^[0-9]{1,4}$/.test(raw)) return null
  const page = Number(raw)
  if (page < 1) return null
  if (pageCount !== null && page > pageCount) return null
  return page
}
