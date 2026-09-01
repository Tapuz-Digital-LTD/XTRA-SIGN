import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * One connection pool per process. Next.js re-evaluates modules on every hot
 * reload in development, which without the global cache opens a new pool each
 * time until Postgres refuses connections.
 */
const globalForDb = globalThis as unknown as { __xtraSignSql?: ReturnType<typeof postgres> }

function client() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')

  if (!globalForDb.__xtraSignSql) {
    globalForDb.__xtraSignSql = postgres(url, { max: 10 })
  }
  return globalForDb.__xtraSignSql
}

export function getDb() {
  return drizzle(client(), { schema })
}

export type Db = ReturnType<typeof getDb>
export { schema }
