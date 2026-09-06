import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Secrets an admin types into the product — a provider's API key, say —
 * are kept encrypted at rest with AES-256-GCM under a key that lives only
 * in the deployment's environment (`SIGN_SECRETS_KEY`). The database never
 * holds the plain value, a screen never shows it again, a log never
 * prints it. Replacing the environment key would orphan stored secrets,
 * which is why it is set once and left alone.
 */

const PREFIX = 'enc:v1:'

function key(): Buffer | null {
  const raw = process.env.SIGN_SECRETS_KEY?.trim()
  if (!raw) return null
  // Accept base64 or hex; anything else is hashed to 32 bytes.
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  const b64 = Buffer.from(raw, 'base64')
  if (b64.length === 32) return b64
  return createHash('sha256').update(raw).digest()
}

export function secretsConfigured(): boolean {
  return key() !== null
}

export function encryptSecret(plain: string): string {
  const k = key()
  if (!k) throw new SecretsUnavailable()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptSecret(stored: string): string {
  const k = key()
  if (!k) throw new SecretsUnavailable()
  if (!stored.startsWith(PREFIX)) throw new Error('not an encrypted secret')
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** What a screen may show of a secret: its last characters, nothing more. */
export function secretHint(plain: string): string {
  const tail = plain.slice(-4)
  return `••••••••••••${tail}`
}

export class SecretsUnavailable extends Error {
  status = 503
  constructor() {
    super('SIGN_SECRETS_KEY is not set on this deployment')
  }
}
