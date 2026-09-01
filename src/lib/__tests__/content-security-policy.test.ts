import { describe, expect, it } from 'vitest'
import { BLOB_UPLOAD_ORIGIN, buildCsp, isConnectableUploadUrl } from '../content-security-policy'

/**
 * The upload broke in production and worked everywhere else, because
 * `connect-src 'self'` blocks the one request the app makes to another origin:
 * the browser's PUT of the chosen file straight to Vercel Blob. Nothing in the
 * page could report it — a request the policy refuses never gets a response.
 *
 * These assertions pin the two halves of that fix together: the directive that
 * permits the host, and the check that the URL actually minted matches it.
 */

/**
 * The exact shape `@vercel/blob` builds, from `constructBlobUrl`:
 * `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}` — with
 * `access` always 'private' here.
 */
const PRESIGNED_UPLOAD_URL =
  'https://store_abc123.private.blob.vercel-storage.com/org/o1/agreements/a1/source/f1.pdf' +
  '?vercel-blob-delegation=tok&vercel-blob-signature=sig'

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `))
  if (!found) throw new Error(`no ${name} directive in policy`)
  return found
}

describe('connect-src', () => {
  it('permits the Blob host the browser uploads to', () => {
    expect(directive(buildCsp({ isProd: true }), 'connect-src')).toBe(
      `connect-src 'self' ${BLOB_UPLOAD_ORIGIN}`,
    )
  })

  it('permits the URL Blob actually mints for a presigned upload', () => {
    expect(isConnectableUploadUrl(PRESIGNED_UPLOAD_URL)).toBe(true)
  })

  it('permits the development stand-in, which is a path on our own origin', () => {
    expect(isConnectableUploadUrl('/api/dev-blob/org/o1/agreements/a1/source/f1.pdf')).toBe(true)
  })

  it('refuses any other origin', () => {
    // Not a wildcard for the whole internet: only the private Blob host.
    expect(isConnectableUploadUrl('https://evil.example.com/upload')).toBe(false)
    expect(isConnectableUploadUrl('https://blob.vercel-storage.com.evil.example.com/x')).toBe(false)
    // `*.` needs a label in front of the suffix.
    expect(isConnectableUploadUrl('https://private.blob.vercel-storage.com/x')).toBe(false)
    // A public store is not what this app writes to, and is not permitted.
    expect(isConnectableUploadUrl('https://store_abc123.public.blob.vercel-storage.com/x')).toBe(
      false,
    )
    // Plain HTTP would strip the transport protection the signed URL relies on.
    expect(isConnectableUploadUrl('http://store_abc123.private.blob.vercel-storage.com/x')).toBe(
      false,
    )
    expect(isConnectableUploadUrl('not a url')).toBe(false)
  })
})

describe('the rest of the policy', () => {
  it('keeps every other source list to our own origin', () => {
    const csp = buildCsp({ isProd: true })
    expect(directive(csp, 'default-src')).toBe("default-src 'self'")
    expect(directive(csp, 'form-action')).toBe("form-action 'self'")
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
  })

  it('gives pdf.js the blob: worker it renders previews from', () => {
    expect(directive(buildCsp({ isProd: true }), 'worker-src')).toBe("worker-src 'self' blob:")
  })

  it("never ships 'unsafe-eval' to production", () => {
    expect(buildCsp({ isProd: true })).not.toContain("'unsafe-eval'")
    // React Refresh needs it locally, and only locally.
    expect(buildCsp({ isProd: false })).toContain("'unsafe-eval'")
  })

  it('upgrades insecure requests in production only', () => {
    expect(buildCsp({ isProd: true })).toContain('upgrade-insecure-requests')
    expect(buildCsp({ isProd: false })).not.toContain('upgrade-insecure-requests')
  })
})
