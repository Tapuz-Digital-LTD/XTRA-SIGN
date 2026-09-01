/**
 * Object storage, behind an interface so the provider can change without
 * touching a single use-case.
 *
 * Two rules the implementations must uphold, and the reason the interface looks
 * the way it does:
 *
 *   1. Nothing is ever public. There is no `getPublicUrl`. The only way to hand
 *      a browser a document is `signedDownloadUrl`, which expires. If a method
 *      that returns a permanent URL appears here later, that is the bug.
 *   2. Nothing is written to the container filesystem. `put` takes bytes and
 *      `get` returns bytes; no path ever crosses this boundary.
 */
export type StoredObject = {
  key: string
  size: number
  contentType: string
}

export interface DocumentStorage {
  /** Stores bytes under a caller-generated key. Overwrites are the caller's problem. */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>

  get(key: string): Promise<Buffer>

  /**
   * A short-lived URL for one object.
   *
   * `expiresInSeconds` is capped by the implementation — a caller must not be
   * able to mint a link that outlives the authorization that produced it.
   */
  signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; downloadFilename?: string },
  ): Promise<string>

  delete(key: string): Promise<void>

  exists(key: string): Promise<boolean>
}
