import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { getStorage, storageIsConfigured } from '@/server/storage/blob'
import { keyFromSegments } from '@/server/storage/key-path'
import { verifyDevDownload } from '@/server/storage/local'

/**
 * Stands in for a Vercel Blob presigned URL during development: PUT for the
 * upload, GET for the download.
 *
 * The client uploads to a URL and the download routes redirect to one either
 * way, so there is one code path in the browser rather than a development
 * branch that is never exercised before it matters.
 *
 * Inert in production: the route refuses outright rather than relying on the
 * caller not to reach it, because a write endpoint that only *usually* isn't
 * there is not a thing to ship.
 */
function disabled() {
  return NextResponse.json({ error: { message: 'Not available.' } }, { status: 404 })
}

export async function PUT(request: Request, context: { params: Promise<{ key: string[] }> }) {
  if (process.env.NODE_ENV === 'production') return disabled()
  // Any working Blob credential means the real store is in use and this
  // stand-in must stay out of the way.
  if (storageIsConfigured()) return disabled()

  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { key: segments } = await context.params

    // Segments arrive already decoded from the router. Decoding them again is
    // exactly how `%252e%252e` becomes `..` after a check has already passed,
    // so they are used as-is. The helper refuses traversal, embedded separators
    // and control characters BEFORE applying the tenant prefix — a `startsWith`
    // on a string containing `..` sees the prefix and misses the escape.
    const key = keyFromSegments(segments, `org/${session.organizationId}/`)
    if (!key) return disabled()

    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: { message: 'Too large.' } }, { status: 413 })
    }

    await getStorage().put(key, bytes, request.headers.get('content-type') ?? 'application/pdf')
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CsrfError || error instanceof UnauthorizedError) return disabled()
    throw error
  }
}

/**
 * The download half. Authorised by the signature in the URL and nothing else —
 * exactly like the presigned Blob URL it stands in for, which is what lets a
 * signer with no account fetch their own copy. The signature is bound to the
 * key and to an expiry, and only this process can produce one.
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  if (process.env.NODE_ENV === 'production') return disabled()
  if (storageIsConfigured()) return disabled()

  const { key: segments } = await context.params
  // Any tenant: the signature, not a session, is the authorization here.
  const key = keyFromSegments(segments, 'org/')
  if (!key) return disabled()

  const { searchParams } = new URL(request.url)
  if (!verifyDevDownload(key, searchParams.get('expires'), searchParams.get('signature'))) {
    return disabled()
  }

  let bytes: Buffer
  try {
    bytes = await getStorage().get(key)
  } catch {
    return disabled()
  }

  const filename = searchParams.get('filename') ?? 'document.pdf'
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      // RFC 5987, so a Hebrew title survives the header.
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
