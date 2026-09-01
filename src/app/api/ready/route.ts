import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/server/db'
import { allowedOrigins } from '@/server/http/csrf'
import { inforuIsConfigured, logOnlyMode } from '@/server/notifications/inforu'
import { getStorage, storageIsConfigured } from '@/server/storage/blob'
import { log } from '@/server/log'

/**
 * Readiness. Answers "can this task actually serve traffic".
 *
 * This is the one the load balancer's target group should use: a task that
 * cannot reach its database should be taken out of rotation, not killed.
 *
 * The body names each dependency so a failing deploy says which one is wrong,
 * but never includes a host, a connection string or a credential — a readiness
 * endpoint is reachable from inside the VPC and should not describe the
 * infrastructure to whatever can reach it.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, boolean> = {}

  checks.database = await getDb()
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false)

  checks.storage = storageIsConfigured()
    ? await getStorage()
        .exists('__readiness_probe__')
        .then(() => true)
        // `exists` returns false for a missing key; only a thrown error means
        // the bucket itself is unreachable.
        .catch(() => false)
    : false

  // Configuration, not connectivity: a wrong flag here means the app would
  // silently not send, which is worse than failing to start.
  checks.notifications = inforuIsConfigured() && !logOnlyMode()

  // Every state-changing route refuses a request whose Origin is not in this
  // list, and the list comes from SIGN_PUBLIC_URL. A deployment where it is
  // unset or unparseable will serve every page and reject every login and
  // upload with a 403 — which is only diagnosable from here.
  checks.origin = allowedOrigins().length > 0

  const ready = Object.values(checks).every(Boolean)
  if (!ready) log.warn('readiness check failed', { checks })

  return NextResponse.json({ ok: ready, checks }, { status: ready ? 200 : 503 })
}
