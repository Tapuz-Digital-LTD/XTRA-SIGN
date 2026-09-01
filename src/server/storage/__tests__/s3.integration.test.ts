import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { S3DocumentStorage } from '../s3'
import { buildStorageKey, sha256 } from '@/server/documents/file-validation'

/**
 * Integration test against the real MinIO from docker-compose.
 *
 * Not mocked: the point is to prove the bucket is actually private and that a
 * signed URL actually expires. A mocked S3 client would pass either way, which
 * is exactly the kind of test that makes a security property look verified
 * when it is not.
 *
 * If MinIO is not reachable the suite FAILS rather than skipping quietly — a
 * silently skipped security test is worse than no test, because the green run
 * still reads as "verified".
 */

const ENDPOINT = process.env.STORAGE_ENDPOINT ?? 'http://localhost:9100'
const BUCKET = process.env.STORAGE_BUCKET ?? 'xtra-sign'

let storage: S3DocumentStorage
const written: string[] = []

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('hello xtra sign')])

beforeAll(async () => {
  const reachable = await fetch(`${ENDPOINT}/minio/health/live`)
    .then((r) => r.ok)
    .catch(() => false)

  if (!reachable) {
    throw new Error(
      `MinIO is not reachable at ${ENDPOINT}. Run: docker compose up -d storage`,
    )
  }

  storage = new S3DocumentStorage({
    endpoint: ENDPOINT,
    bucket: BUCKET,
    region: 'il-central-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? 'xtra',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'xtra-dev-secret',
  })
})

afterAll(async () => {
  for (const key of written) {
    await storage.delete(key).catch(() => {})
  }
})

function key() {
  const k = buildStorageKey({
    organizationId: '11111111-1111-4111-8111-111111111111',
    agreementId: crypto.randomUUID(),
    purpose: 'source',
    ext: 'pdf',
  })
  written.push(k)
  return k
}

describe('S3DocumentStorage against real MinIO', () => {
  it('round-trips bytes without corrupting them', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const back = await storage.get(k)
    expect(sha256(back)).toBe(sha256(PDF))
  })

  it('reports existence accurately', async () => {
    const k = key()
    expect(await storage.exists(k)).toBe(false)
    await storage.put(k, PDF, 'application/pdf')
    expect(await storage.exists(k)).toBe(true)
  })

  it('THE BUCKET IS PRIVATE: an unsigned request for a stored object is refused', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const response = await fetch(`${ENDPOINT}/${BUCKET}/${k}`)

    expect(response.ok).toBe(false)
    expect([401, 403]).toContain(response.status)
  })

  it('a signed URL does return the bytes', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 60 })
    const response = await fetch(url)

    expect(response.ok).toBe(true)
    expect(sha256(Buffer.from(await response.arrayBuffer()))).toBe(sha256(PDF))
  })

  it('an expired signed URL stops working', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 1 })
    await new Promise((r) => setTimeout(r, 2500))

    const response = await fetch(url)
    expect(response.ok).toBe(false)
    expect([400, 403]).toContain(response.status)
  }, 15_000)

  it('caps the lifetime a caller can ask for', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    // 24 hours requested; the implementation must clamp to its own ceiling.
    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 86_400 })
    const expires = Number(new URL(url).searchParams.get('X-Amz-Expires'))

    expect(expires).toBe(300)
  })

  it('forces a download rather than inline rendering', async () => {
    // A PDF rendered inline can run script; as an attachment it cannot.
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 60 })
    const response = await fetch(url)

    expect(response.headers.get('content-disposition')).toContain('attachment')
  })

  it('keeps a Hebrew filename intact through the download header', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, {
      expiresInSeconds: 60,
      downloadFilename: 'הסכם ספק.pdf',
    })
    const response = await fetch(url)
    const disposition = response.headers.get('content-disposition') ?? ''

    expect(disposition).toContain("filename*=UTF-8''")
    expect(decodeURIComponent(disposition)).toContain('הסכם ספק.pdf')
  })

  it('deletes an object for real', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')
    await storage.delete(k)
    expect(await storage.exists(k)).toBe(false)
  })
})
