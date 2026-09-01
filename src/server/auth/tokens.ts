import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

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

/**
 * Password hashing with scrypt from the Node standard library.
 *
 * Deliberately not bcrypt/argon2: those are native addons to install, build and
 * keep patched, and scrypt is memory-hard, in the stdlib, and sufficient for a
 * handful of staff accounts.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scrypt(password.normalize('NFKC'), salt, 64)) as Buffer
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false

  const derived = (await scrypt(
    password.normalize('NFKC'),
    Buffer.from(saltHex, 'hex'),
    64,
  )) as Buffer
  return safeEqualHex(derived.toString('hex'), hashHex)
}

/** Six digits from the CSPRNG. `Math.random()` is predictable and never used here. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
