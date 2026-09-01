import type { DocumentStorage, StoredObject } from '@/server/storage/types'

/**
 * In-memory document storage for tests.
 *
 * Vercel Blob has no local emulator, so the alternative to this is either
 * hitting the real service on every test run or not testing the code paths that
 * store documents at all.
 *
 * It implements the same interface, so everything above it — key construction,
 * the tenant prefix, hashing, the authorization that resolves a key — is
 * exercised for real. What it deliberately does NOT prove is that Blob itself
 * keeps an object private or that a presigned URL expires. Those are properties
 * of the service, and they are verified against the real service by the smoke
 * suite before the first deploy.
 */
export class FakeStorage implements DocumentStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>()

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    // Copied, so a caller mutating its buffer afterwards cannot change what is
    // "stored" — the real service would have taken a snapshot.
    this.objects.set(key, { body: Buffer.from(body), contentType })
    return { key, size: body.length, contentType }
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key)
    if (!found) throw new Error(`Object not found: ${key}`)
    return Buffer.from(found.body)
  }

  async signedDownloadUrl(key: string, options: { expiresInSeconds: number }): Promise<string> {
    // Shaped like the real thing so a caller inspecting it does not get a
    // surprise, but it grants nothing — there is no server behind it.
    const expires = Math.min(Math.max(options.expiresInSeconds, 1), 300)
    return `https://fake.blob.test/${encodeURIComponent(key)}?expires=${expires}`
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key)
  }

  /** Test-only: how many objects are held. Used to assert cleanup happened. */
  size(): number {
    return this.objects.size
  }

  clear(): void {
    this.objects.clear()
  }
}

export const fakeStorage = new FakeStorage()
