import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { DocumentStorage, StoredObject } from './types'

/**
 * S3-compatible storage. One implementation serves both local dev (MinIO) and
 * production (S3 or any S3-compatible provider) — a second local-only code path
 * would drift from the one that actually runs in production.
 *
 * The bucket must be private. Nothing here sets an ACL, and nothing returns a
 * permanent URL.
 */

/**
 * Hard ceiling on a signed URL's life.
 *
 * A signed URL is a bearer token in a query string: it lands in browser history,
 * in a proxy log, and in whatever the user pastes it into. Five minutes is long
 * enough to start a download and short enough that a leaked link is stale before
 * it is useful.
 */
const MAX_SIGNED_URL_SECONDS = 300

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config?: {
    endpoint?: string
    region?: string
    bucket?: string
    accessKeyId?: string
    secretAccessKey?: string
  }) {
    const endpoint = config?.endpoint ?? process.env.STORAGE_ENDPOINT
    const region = config?.region ?? process.env.STORAGE_REGION ?? 'il-central-1'
    const accessKeyId = config?.accessKeyId ?? process.env.STORAGE_ACCESS_KEY_ID
    const secretAccessKey = config?.secretAccessKey ?? process.env.STORAGE_SECRET_ACCESS_KEY
    this.bucket = config?.bucket ?? process.env.STORAGE_BUCKET ?? ''

    if (!this.bucket) throw new Error('STORAGE_BUCKET is not configured')
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Storage credentials are not configured')
    }

    this.client = new S3Client({
      region,
      // Set for MinIO and other S3-compatible endpoints; absent for real S3.
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Force a download rather than inline rendering. A PDF rendered inline
        // on our own origin can run script against it; as an attachment it
        // cannot. No ACL is set, so the object inherits the private bucket.
        ContentDisposition: 'attachment',
      }),
    )
    return { key, size: body.length, contentType }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    const bytes = await response.Body?.transformToByteArray()
    if (!bytes) throw new Error(`Object has no body: ${key}`)
    return Buffer.from(bytes)
  }

  async signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; downloadFilename?: string },
  ): Promise<string> {
    // Clamp rather than trust: a caller passing 24h must not get 24h.
    const expiresIn = Math.min(Math.max(options.expiresInSeconds, 1), MAX_SIGNED_URL_SECONDS)

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.downloadFilename
          ? {
              // RFC 5987 encoding so Hebrew filenames survive the header.
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
                options.downloadFilename,
              )}`,
            }
          : {}),
      }),
      { expiresIn },
    )
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch {
      return false
    }
  }
}

let cached: DocumentStorage | null = null

/** Lazily built so importing this module never throws at build time. */
export function getStorage(): DocumentStorage {
  if (!cached) cached = new S3DocumentStorage()
  return cached
}

export function storageIsConfigured(): boolean {
  return Boolean(
    process.env.STORAGE_BUCKET &&
      process.env.STORAGE_ACCESS_KEY_ID &&
      process.env.STORAGE_SECRET_ACCESS_KEY,
  )
}

export { MAX_SIGNED_URL_SECONDS }
