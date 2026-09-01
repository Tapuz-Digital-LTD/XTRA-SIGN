import { del, get, head, issueSignedToken, presignUrl, put } from '@vercel/blob'
import type { DocumentStorage, StoredObject } from './types'

/**
 * Document storage on Vercel Blob.
 *
 * Every object is written with `access: 'private'`. There is no public URL for
 * a signed agreement, ever — the only way a browser receives one is a presigned
 * URL that expires, or bytes streamed through a route that checked
 * authorization first.
 *
 * This implements the same `DocumentStorage` interface the S3 version did, so
 * the nine call sites across the app are untouched by the move. That interface
 * existing is the reason this is one file rather than a migration.
 */

/**
 * Hard ceiling on how long a presigned URL lives.
 *
 * A presigned URL is a bearer token in a query string: it lands in browser
 * history, in a proxy log, and in whatever the user pastes it into. Five
 * minutes is long enough to start a download and short enough that a leaked
 * link is stale before it is useful.
 */
const MAX_SIGNED_URL_SECONDS = 300

export class VercelBlobStorage implements DocumentStorage {
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await put(key, body, {
      access: 'private',
      contentType,
      // The key already carries a UUID and encodes the tenant; a random suffix
      // would make it unaddressable from the database row that points at it.
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return { key, size: body.length, contentType }
  }

  async get(key: string): Promise<Buffer> {
    const result = await get(key, { access: 'private' })
    if (!result || result.statusCode !== 200) throw new Error(`Object not found: ${key}`)
    return Buffer.from(await new Response(result.stream).arrayBuffer())
  }

  async signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; downloadFilename?: string },
  ): Promise<string> {
    // Clamp rather than trust: a caller asking for 24 hours must not get it.
    const seconds = Math.min(Math.max(options.expiresInSeconds, 1), MAX_SIGNED_URL_SECONDS)
    const validUntil = Date.now() + seconds * 1000

    // Scoped to this one path and to `get` alone — a token that could also
    // write or delete would be a far worse thing to leak.
    const token = await issueSignedToken({
      pathname: key,
      operations: ['get'],
      validUntil,
    })

    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: key,
      access: 'private',
      validUntil,
      // A signed document must not sit in a shared CDN cache after the URL
      // that fetched it has expired.
      useCache: false,
    })
    return presignedUrl
  }

  async delete(key: string): Promise<void> {
    await del(key)
  }

  async exists(key: string): Promise<boolean> {
    try {
      // `head` has no access option; a private blob is addressed by pathname
      // and authorised by the store token.
      const result = await head(key)
      return Boolean(result)
    } catch {
      return false
    }
  }
}

/**
 * A presigned URL the browser may upload to directly.
 *
 * The file never passes through a function, which keeps a 25MB upload off the
 * request path entirely. The constraints below are enforced by Blob itself.
 *
 * IMPORTANT: `allowedContentTypes` checks the Content-Type the browser
 * declares, which the browser's user controls. It is a convenience, not a
 * security control — the bytes are still validated server-side after the
 * upload, and a file that fails that check is deleted.
 */
export async function presignUpload(input: {
  key: string
  maxBytes: number
  contentTypes: string[]
  expiresInSeconds?: number
}): Promise<string> {
  // With no Blob token, development uploads to the app's own stand-in route.
  // The client PUTs to a URL either way, so there is one code path in the
  // browser rather than a development branch nobody exercises.
  if (!storageIsConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Blob storage is not configured: set BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with VERCEL_OIDC_TOKEN')
    }
    return `/api/dev-blob/${input.key.split('/').map(encodeURIComponent).join('/')}`
  }

  const validUntil = Date.now() + (input.expiresInSeconds ?? 120) * 1000

  const token = await issueSignedToken({
    pathname: input.key,
    operations: ['put'],
    validUntil,
    allowedContentTypes: input.contentTypes,
    maximumSizeInBytes: input.maxBytes,
  })

  const { presignedUrl } = await presignUrl(token, {
    operation: 'put',
    pathname: input.key,
    access: 'private',
    validUntil,
    allowedContentTypes: input.contentTypes,
    maximumSizeInBytes: input.maxBytes,
    addRandomSuffix: false,
    allowOverwrite: false,
  })
  return presignedUrl
}

let cached: DocumentStorage | null = null

/**
 * Lazily built so importing this module never throws at build time.
 *
 * With no Blob token, development falls back to local disk so `npm run dev`
 * works with nothing provisioned. Production never falls back: a missing token
 * there means the deployment is misconfigured, and quietly writing documents to
 * a container's disk — which vanishes on the next deploy — is far worse than
 * failing at startup.
 */
export function getStorage(): DocumentStorage {
  if (cached) return cached

  if (!storageIsConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Blob storage is not configured: set BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with VERCEL_OIDC_TOKEN')
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalDiskStorage } = require('./local') as typeof import('./local')
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'no Blob credentials — documents are being written to .data/blob (development only)',
      }),
    )
    cached = new LocalDiskStorage()
    return cached
  }

  cached = new VercelBlobStorage()
  return cached
}

/**
 * Two credential paths, because Vercel now provisions the second one.
 *
 * Connecting a Blob store to a project no longer injects a long-lived
 * `BLOB_READ_WRITE_TOKEN`. It injects `BLOB_STORE_ID`, and each call
 * authenticates with a short-lived OIDC token the platform mints — which the
 * SDK fetches from the request context via `@vercel/oidc`, NOT from an
 * environment variable. So the presence of `VERCEL_OIDC_TOKEN` in the env must
 * not be part of this check: at runtime on Vercel it is usually absent even
 * though the credential is right there.
 *
 * This is therefore only "is a store connected" — `BLOB_STORE_ID` is injected
 * exactly when one is. Whether the credential actually works is a different
 * question, answered by the readiness probe's real call against the store.
 */
export function storageIsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
}

export { MAX_SIGNED_URL_SECONDS }
