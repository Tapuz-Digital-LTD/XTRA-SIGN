import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { getStorage } from '@/server/storage/blob'
import { keyFromSegments } from '@/server/storage/key-path'

/**
 * Stands in for a Vercel Blob presigned PUT during development.
 *
 * The client uploads to a URL either way, so there is one code path in the
 * browser rather than a development branch that is never exercised before it
 * matters.
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
  if (process.env.BLOB_READ_WRITE_TOKEN) return disabled()

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
