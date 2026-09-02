/**
 * A Content-Disposition value that survives a Hebrew filename.
 *
 * HTTP header values are latin1, so "ספקים.xlsx" thrown straight into the
 * header throws before the response is ever sent. RFC 5987 handles this: an
 * ASCII fallback for anything old, and a percent-encoded UTF-8 form that every
 * current browser prefers.
 */
export function attachmentFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
