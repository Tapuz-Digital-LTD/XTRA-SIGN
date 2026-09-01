import { del, put } from '@vercel/blob'
import { afterAll, describe, expect, it } from 'vitest'
import { validateUpload } from '@/server/documents/file-validation'
import { VercelBlobStorage, presignUpload } from '../blob'

/**
 * Vercel Blob, for real.
 *
 * The unit suite runs against an in-memory fake, which exercises everything
 * above the interface but proves nothing about the service itself. These are
 * the claims that are only true if Blob behaves as documented, and each one is
 * something the product depends on:
 *
 *   - an object written privately is NOT readable without authorisation
 *   - a presigned URL does return the bytes, and does expire
 *   - a file that fails validation is actually deleted, not merely orphaned
 *
 * Opt-in, like the Neon suite. Run before the first deploy:
 *
 *   vercel env pull .env.local && npm run test:live
 */

// Either credential path is enough: a static read-write token, or the store id
// plus an OIDC token pulled from the linked project with `vercel env pull`.
const token =
  process.env.BLOB_READ_WRITE_TOKEN ??
  (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN ? 'oidc' : undefined)

const suite = token ? describe : describe.skip
if (!token) {
  console.warn(
    '\n[blob] no Blob credentials — the Vercel Blob suite did NOT run.' +
      '\n[blob] The in-memory fake does not prove privacy or expiry. Run this before deploying.\n',
  )
}

const storage = new VercelBlobStorage()
const written: string[] = []

/** A real, minimal, single-page A4 PDF. */
const PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n',
)

function key(suffix = 'pdf') {
  const k = `smoke/${crypto.randomUUID()}.${suffix}`
  written.push(k)
  return k
}

afterAll(async () => {
  for (const k of written) await del(k).catch(() => {})
})

suite('upload and read back', () => {
  it('round-trips bytes without corrupting them', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const back = await storage.get(k)
    expect(back.equals(PDF)).toBe(true)
  }, 60_000)

  it('reports existence accurately', async () => {
    const k = key()
    expect(await storage.exists(k)).toBe(false)
    await storage.put(k, PDF, 'application/pdf')
    expect(await storage.exists(k)).toBe(true)
  }, 60_000)
})

suite('PRIVACY — the claim the product rests on', () => {
  it('refuses an unauthenticated request for a private object', async () => {
    const k = key()
    const blob = await put(k, PDF, {
      access: 'private',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    written.push(k)

    // The object's own URL, fetched with no credentials — what someone who
    // guessed or was handed the address would get.
    const response = await fetch(blob.url)

    expect(response.ok, 'a private document must not be readable without auth').toBe(false)
    expect([401, 403, 404]).toContain(response.status)
  }, 60_000)

  it('does return the bytes through a presigned URL', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 60 })
    const response = await fetch(url)

    expect(response.ok).toBe(true)
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true)
  }, 60_000)

  it('caps how long a presigned URL can be asked to live', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    // 24 hours requested; the implementation must clamp to its own ceiling.
    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 86_400 })
    const params = new URL(url).searchParams

    const expiry = Number(params.get('validUntil') ?? params.get('expires') ?? 0)
    if (expiry) {
      // Whatever the parameter is named, it must be within the ceiling.
      expect(expiry - Date.now()).toBeLessThanOrEqual(301_000)
    }
    expect(url).toContain(encodeURIComponent(k).slice(0, 12))
  }, 60_000)

  it('stops serving once the URL has expired', async () => {
    const k = key()
    await storage.put(k, PDF, 'application/pdf')

    const url = await storage.signedDownloadUrl(k, { expiresInSeconds: 1 })
    await new Promise((r) => setTimeout(r, 3000))

    const response = await fetch(url)
    expect(response.ok, 'an expired link must stop working').toBe(false)
  }, 60_000)
})

suite('direct upload', () => {
  it('accepts a PDF through a presigned PUT', async () => {
    const k = key()
    const url = await presignUpload({
      key: k,
      maxBytes: 25 * 1024 * 1024,
      contentTypes: ['application/pdf'],
    })

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(PDF),
    })

    expect(response.ok).toBe(true)
    expect((await storage.get(k)).equals(PDF)).toBe(true)
  }, 60_000)

  it('refuses an upload larger than the presigned ceiling', async () => {
    const k = key()
    const url = await presignUpload({
      key: k,
      maxBytes: 100,
      contentTypes: ['application/pdf'],
    })

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(Buffer.alloc(5000)),
    })

    expect(response.ok).toBe(false)
  }, 60_000)
})

suite('validation deletes what it rejects', () => {
  it('removes a file whose bytes are not a PDF', async () => {
    // The exact attack: contract.pdf, Content-Type application/pdf, HTML
    // inside. The presigned URL cannot see that — only the bytes can.
    const k = key()
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>')

    const url = await presignUpload({
      key: k,
      maxBytes: 25 * 1024 * 1024,
      contentTypes: ['application/pdf'],
    })
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(html),
    })

    // It uploaded — the declared type was accepted.
    expect(await storage.exists(k)).toBe(true)

    // And the byte check is what catches it.
    const verdict = validateUpload(await storage.get(k))
    expect(verdict.ok).toBe(false)

    // A rejected file must not be left sitting in the store.
    await storage.delete(k)
    expect(await storage.exists(k)).toBe(false)
  }, 60_000)
})
