import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * The database connection.
 *
 * Plain `pg` over `DATABASE_URL`, not Neon's WebSocket driver. Neon speaks
 * standard Postgres on its pooled endpoint, so this works there — and it also
 * works against any Postgres, which the WebSocket driver does not: it refuses
 * to connect to anything that is not a Neon host, so local development would
 * need a proxy to run at all.
 *
 * Interactive transactions are the requirement that rules out the HTTP driver
 * entirely. Six places depend on them — completing a signature writes the signed
 * file, the signature, the recipient, the status and two audit events as one
 * unit, and losing that atomicity means a signed PDF whose document still says
 * "awaiting signature". `pg` supports them; `neon-http` does not.
 */

/**
 * One pool per process, cached on globalThis.
 *
 * Next re-evaluates modules on every hot reload in development, and a fresh
 * pool each time exhausts the connection limit. In production the same cache
 * lets a warm function instance reuse the pool across invocations.
 */
const globalForDb = globalThis as unknown as { __xtraSignPool?: Pool }

function pool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  if (!globalForDb.__xtraSignPool) {
    globalForDb.__xtraSignPool = new Pool({
      connectionString,
      // Small on purpose: many function instances each holding a large pool is
      // how a serverless app exhausts a database's connection limit. Point this
      // at a pooled connection string in production and the pooler does the
      // real multiplexing.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    })
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
