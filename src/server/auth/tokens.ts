import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Secret-handling primitives shared by staff sessions, signing tokens and OTPs.
 *
 * Everything secret is stored hashed. A leaked database must not be a set of
 * working credentials, working signing links, or guessable OTP codes.
 */

/** 32 bytes of CSPRNG entropy. Not guessable, not enumerable, not sequential. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * SHA-256 for high-entropy tokens.
 *
 * A password needs a slow KDF because it has little entropy and is brute
 * forcible. A 256-bit random token is not, so a fast hash is correct here — and
 * being fast matters, since this runs on every signing-link request.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a digest leaks its prefix through timing. It matters most for the
 * OTP path, where an attacker controls the input and can retry.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Six digits from the CSPRNG. `Math.random()` is predictable and never used here. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
