import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/server/db/schema'

/**
 * A real Postgres for the test suite, compiled to WebAssembly and running
 * in-process.
 *
 * Not a mock and not an in-memory imitation: the same SQL, the same
 * constraints, the same unique indexes and the same migrations production
 * runs. A mocked database would let a broken WHERE clause pass, and the
 * tenant-boundary checks are the most important thing in this suite.
 *
 * What it is NOT is a substitute for Neon. Anything that depends on how the
 * real driver behaves — interactive transactions over a WebSocket pool,
 * concurrent writers, migrations against the actual instance — is covered by
 * the separate Neon suite, which runs against a real database.
 */

let instance: PGlite | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let ready: Promise<void> | null = null

export function testDb() {
  if (!db) throw new Error('test database not initialised — did setup run?')
  return db
}

/** Idempotent: the suite runs single-threaded, so one instance serves every file. */
export async function initTestDb(): Promise<void> {
  if (ready) return ready

  ready = (async () => {
    instance = new PGlite()
    db = drizzle(instance, { schema })
    // The real migration files, in order. If a migration is broken, the whole
    // suite fails here rather than in a confusing assertion later.
    await migrate(db, { migrationsFolder: './drizzle' })
  })()

  return ready
}

export async function closeTestDb(): Promise<void> {
  await instance?.close()
  instance = null
  db = null
  ready = null
}
