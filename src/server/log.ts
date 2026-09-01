/**
 * Structured logging.
 *
 * One JSON object per line, because CloudWatch Logs Insights can query fields
 * but cannot parse prose. Every call goes through here so that the redaction
 * below is not something each call site has to remember.
 *
 * What must never appear in a log line: an OTP, a signing token, a session
 * value, a password, or InforU credentials. A log is the easiest place for a
 * secret to end up somewhere it is retained for months and read by more people
 * than the database ever is.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

/** Keys whose value is replaced wholesale, at any depth. */
const REDACT = [
  'password', 'passwordhash', 'token', 'tokenhash', 'sessionhash', 'code',
  'codehash', 'otp', 'secret', 'credentials', 'authorization', 'cookie',
  'signature', 'basecredentials',
]

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT.includes(key.toLowerCase()) ? '[redacted]' : redact(inner, depth + 1)
  }
  return out
}

function write(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const line = {
    level,
    time: new Date().toISOString(),
    service: 'xtra-sign',
    env: process.env.NODE_ENV ?? 'development',
    msg: message,
    ...(redact(fields) as Record<string, unknown>),
  }

  // stdout/stderr only. The container writes to the log driver; nothing here
  // owns a file, which is what makes the task disposable.
  const serialised = JSON.stringify(line)
  if (level === 'error' || level === 'warn') console.error(serialised)
  else console.log(serialised)
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') write('debug', msg, fields)
  },
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
}

/**
 * The caller's real address behind the ALB.
 *
 * A hop COUNT, not "trust the whole chain": X-Forwarded-For is appended to by
 * each proxy, so the client controls everything to the left of the entries our
 * own infrastructure added. Taking the last entry — the one the ALB itself
 * wrote — is the only part a client cannot forge. Getting this wrong puts every
 * visitor in one rate-limit bucket, or lets one pick their own.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return null

  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? '1')
  const chain = forwarded.split(',').map((v) => v.trim()).filter(Boolean)
  if (chain.length === 0) return null

  const index = chain.length - hops
  return chain[index >= 0 ? index : 0] ?? null
}
