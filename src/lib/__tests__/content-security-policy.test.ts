import { afterEach, describe, expect, it } from 'vitest'
import { blobApiOrigin, buildCsp, isConnectableUploadUrl } from '../content-security-policy'

/**
 * The upload broke in production and worked everywhere else, because
 * `connect-src 'self'` blocks the one request the app makes to another origin:
 * the browser's PUT of the chosen file straight to Vercel Blob. Nothing in the
 * page could report it — a request the policy refuses never gets a response.
 *
 * These assertions pin the two halves of that fix together: the directive that
 * permits the origin, and the check that the URL actually minted matches it.
 */

/**
 * The exact shape `@vercel/blob` builds for a presigned PUT, from
 * `buildPresignedPutUrl`: the API base (`getApiUrl`) with the pathname and
 * the signature in the query. NOT the store host — that is where a presigned
 * GET goes, and the two must not be confused again.
 */
const PRESIGNED_PUT_URL =
  'https://vercel.com/api/blob/?pathname=org%2Fo1%2Fagreements%2Fa1%2Fsource%2Ff1.pdf' +
  '&vercel-blob-delegation=tok&vercel-blob-signature=sig'

const PRESIGNED_GET_URL =
  'https://store_abc123.private.blob.vercel-storage.com/org/o1/agreements/a1/source/f1.pdf' +
  '?vercel-blob-delegation=tok&vercel-blob-signature=sig'

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `))
  if (!found) throw new Error(`no ${name} directive in policy`)
  return found
}

afterEach(() => {
  delete process.env.VERCEL_BLOB_API_URL
  delete process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL
})

describe('connect-src', () => {
  it('permits the Blob API origin the browser uploads to', () => {
    expect(directive(buildCsp({ isProd: true }), 'connect-src')).toBe(
      "connect-src 'self' https://vercel.com",
    )
  })

  it('permits the URL Blob actually mints for a presigned upload', () => {
    expect(isConnectableUploadUrl(PRESIGNED_PUT_URL)).toBe(true)
  })

  it('permits the development stand-in, which is a path on our own origin', () => {
    expect(isConnectableUploadUrl('/api/dev-blob/org/o1/agreements/a1/source/f1.pdf')).toBe(true)
  })

  it('follows the same override the SDK honours', () => {
    // A self-hosted or staging Blob API moves the upload origin with it; the
    // policy and the guard must move together or the upload dies again.
    process.env.VERCEL_BLOB_API_URL = 'https://blob-staging.example.com/api/blob'
    expect(blobApiOrigin()).toBe('https://blob-staging.example.com')
    expect(directive(buildCsp({ isProd: true }), 'connect-src')).toBe(
      "connect-src 'self' https://blob-staging.example.com",
    )
    expect(isConnectableUploadUrl('https://blob-staging.example.com/api/blob/?pathname=x')).toBe(
      true,
    )
    expect(isConnectableUploadUrl(PRESIGNED_PUT_URL)).toBe(false)
  })

  it('refuses any other origin', () => {
    expect(isConnectableUploadUrl('https://evil.example.com/upload')).toBe(false)
    expect(isConnectableUploadUrl('https://vercel.com.evil.example.com/api/blob/')).toBe(false)
    // The store host is where downloads come from, not where uploads go; the
    // guard exists precisely to catch that confusion.
    expect(isConnectableUploadUrl(PRESIGNED_GET_URL)).toBe(false)
    // Plain HTTP would strip the transport protection the signed URL relies on.
    expect(isConnectableUploadUrl('http://vercel.com/api/blob/?pathname=x')).toBe(false)
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
