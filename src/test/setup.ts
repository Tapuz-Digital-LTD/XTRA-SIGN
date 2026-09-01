import { config } from 'dotenv'
import { afterAll, vi } from 'vitest'
import { fakeStorage } from './fake-storage'
import { closeTestDb, initTestDb, testDb } from './pglite'

// Local values for anything the code reads from the environment. Never a real
// credential: the suite must not be able to send a message or touch a real
// database by accident.
config({ path: '.env.test', quiet: true })

process.env.SIGN_PUBLIC_URL ??= 'https://sign.test'
process.env.SIGN_LOG_NOTIFICATIONS ??= 'true'
// NODE_ENV is read-only in the type definitions; vitest already sets it.

/**
 * The database every test sees is PGlite, and the storage is in-memory.
 *
 * Mocked at the module boundary rather than by passing a client around: the
 * use-cases call `getDb()` and `getStorage()` directly, which is what makes
 * them readable, and changing that shape just to make them testable would be
 * the tail wagging the dog.
 */
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema')
  return { getDb: () => testDb(), schema }
})

vi.mock('@/server/storage/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/storage/blob')>()
  return {
    ...actual,
    getStorage: () => fakeStorage,
    storageIsConfigured: () => true,
  }
})

/**
 * Top-level await, not `beforeAll`.
 *
 * A test file's imports are evaluated before any hook runs, and several suites
 * call `getDb()` at module scope. Waiting for a hook would hand them a database
 * that does not exist yet; blocking here means the schema is in place before a
 * single test module is loaded.
 */
await initTestDb()

afterAll(async () => {
  fakeStorage.clear()
  await closeTestDb()
})
