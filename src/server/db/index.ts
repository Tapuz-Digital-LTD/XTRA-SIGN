import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

/**
 * The database connection.
 *
 * `neon-serverless` (WebSocket Pool), NOT `neon-http`. The HTTP driver cannot
 * do interactive transactions, and six places here depend on them — completing
 * a signature writes the signed file, the signature row, the recipient, the
 * agreement status and two audit events as one unit. Losing atomicity there
 * means a signed PDF whose document still says "awaiting signature", which is
 * not a state a signing system may ever be in.
 */

// Node needs a WebSocket implementation; the Vercel runtime has one built in.
if (typeof WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neonConfig.webSocketConstructor = require('ws')
}

/**
 * One pool per process, cached on globalThis.
 *
 * Next re-evaluates modules on every hot reload in development, and a fresh
 * pool each time exhausts the connection limit. In production the same cache
 * lets Fluid Compute reuse the pool across invocations on a warm instance.
 */
const globalForDb = globalThis as unknown as { __xtraSignPool?: Pool }

function pool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  if (!globalForDb.__xtraSignPool) {
    globalForDb.__xtraSignPool = new Pool({ connectionString })
  }
  return globalForDb.__xtraSignPool
}

/**
 * A function, not a module-level constant.
 *
 * `next build` evaluates top-level module code, so constructing the client at
 * import time crashes the build whenever DATABASE_URL is not yet set — which is
 * exactly the first deploy, before the database is provisioned.
 *
 * Deliberately not a Proxy: libraries that inspect the client object break in
 * ways that surface as a hang with no error.
 */
export function getDb() {
  return drizzle(pool(), { schema })
}

export type Db = ReturnType<typeof getDb>
export { schema }
