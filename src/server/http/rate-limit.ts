import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'

/**
 * Rate limiting.
 *
 * Backed by the database, not an in-process Map. Production runs at least two
 * tasks behind a load balancer, so an in-memory counter multiplies every limit
 * by the task count and resets on each deploy — which is exactly when someone
 * is most likely to be hammering the login form.
 *
 * Postgres rather than Redis: the database is already there, these counters are
 * tiny, and a second piece of infrastructure to run and pay for is not worth it
 * at this volume. If throughput ever makes this the bottleneck, the interface
 * is one function and Redis slots in behind it.
 */

export type LimitRule = {
  /** Attempts allowed inside the window. */
  limit: number
  windowMs: number
}

/**
 * The limits, in one place.
 *
 * Login and password-reset are the two that matter: they are unauthenticated,
 * they accept a guessable secret, and an attacker gets unlimited attempts
 * without them.
 */
export const LIMITS = {
  login: { limit: 5, windowMs: 15 * 60_000 },
  forgotPassword: { limit: 3, windowMs: 60 * 60_000 },
  inviteAccept: { limit: 10, windowMs: 60 * 60_000 },
  inviteCreate: { limit: 20, windowMs: 60 * 60_000 },
  otpSend: { limit: 5, windowMs: 30 * 60_000 },
  otpVerify: { limit: 10, windowMs: 15 * 60_000 },
  upload: { limit: 60, windowMs: 60 * 60_000 },
  signingLink: { limit: 60, windowMs: 15 * 60_000 },
} as const satisfies Record<string, LimitRule>

export type LimitName = keyof typeof LIMITS

export type LimitResult = {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. For the Retry-After header. */
  retryAfter: number
}

/**
 * Consumes one attempt.
 *
 * The whole thing is a single atomic UPSERT: two concurrent requests must not
 * both read "4 used" and both write "5", which is how a limit of 5 becomes a
 * limit of 10 under exactly the load it exists to stop.
 */
export async function consume(
  name: LimitName,
  key: string,
  rule: LimitRule = LIMITS[name],
): Promise<LimitResult> {
  const db = getDb()
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs)
  const expiresAt = new Date(windowStart.getTime() + rule.windowMs)

  // The identifier is hashed on the way in by the caller where it is personal
  // (an email), so this table never becomes a list of who tried to log in.
  const bucket = `${name}:${key}`

  try {
    const [row] = await db
      .insert(schema.rateLimits)
      .values({ bucket, windowStart, expiresAt, count: 1 })
      .onConflictDoUpdate({
        target: [schema.rateLimits.bucket, schema.rateLimits.windowStart],
        set: { count: sql`${schema.rateLimits.count} + 1` },
      })
      .returning({ count: schema.rateLimits.count })

    const used = row?.count ?? 1
    const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000))

    if (used > rule.limit) {
      log.warn('rate limit exceeded', { limit: name, used, allowed: rule.limit })
      return { allowed: false, remaining: 0, retryAfter }
    }

    return { allowed: true, remaining: rule.limit - used, retryAfter }
  } catch (error) {
    // Failing OPEN is deliberate and narrow: the database being unreachable
    // already fails the request downstream, and failing closed here would turn
    // a database blip into "nobody can log in" with no way back.
    log.error('rate limit check failed', { limit: name, error: String(error) })
    return { allowed: true, remaining: rule.limit, retryAfter: 0 }
  }
}

/** Removes expired buckets. Called opportunistically, not on a schedule. */
export async function pruneRateLimits(): Promise<void> {
  await getDb()
    .delete(schema.rateLimits)
    .where(sql`${schema.rateLimits.expiresAt} < now()`)
    .catch(() => {})
}

/** Whether a bucket is already over its limit, without consuming an attempt. */
export async function isLimited(name: LimitName, key: string): Promise<boolean> {
  const rule = LIMITS[name]
  const windowStart = new Date(Math.floor(Date.now() / rule.windowMs) * rule.windowMs)

  const [row] = await getDb()
    .select({ count: schema.rateLimits.count })
    .from(schema.rateLimits)
    .where(
      and(
        eq(schema.rateLimits.bucket, `${name}:${key}`),
        eq(schema.rateLimits.windowStart, windowStart),
        gt(schema.rateLimits.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return (row?.count ?? 0) > rule.limit
}
