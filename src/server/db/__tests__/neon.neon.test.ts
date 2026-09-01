import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../schema'

/**
 * The things PGlite cannot answer.
 *
 * PGlite is a real Postgres and covers the SQL, the constraints and the
 * migrations — but it is in-process and single-connection. Interactive
 * transactions over a real pool, a rollback that actually rolls back across the
 * network, two writers racing on separate connections, and whether the
 * migrations apply to the real instance are properties of Neon and the pool,
 * not of Postgres-the-language.
 *
 * Opt-in on purpose. It needs a real database, so it runs before a deploy
 * rather than on every local `npm test`:
 *
 *   NEON_TEST_DATABASE_URL=postgres://… npm run test:neon
 *
 * The URL must point at a scratch database or a Neon branch. It creates and
 * deletes rows.
 */

const url = process.env.NEON_TEST_DATABASE_URL

// Skipped loudly rather than silently: a green run that tested nothing is worse
// than no run at all.
const suite = url ? describe : describe.skip
if (!url) {
  console.warn(
    '\n[neon] NEON_TEST_DATABASE_URL is not set — the Neon suite did NOT run.' +
      '\n[neon] PGlite coverage does not substitute for it. Run it before deploying.\n',
  )
}

let pool: Pool
let db: ReturnType<typeof drizzle<typeof schema>>
let orgId: string

beforeAll(async () => {
  if (!url) return
  // The same driver and the same pool settings the app uses.
  pool = new Pool({ connectionString: url, max: 3 })
  db = drizzle(pool, { schema })
}, 60_000)

afterAll(async () => {
  if (!url) return
  if (orgId) {
    await db.delete(schema.users).where(eq(schema.users.organizationId, orgId)).catch(() => {})
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId)).catch(() => {})
  }
  await pool?.end().catch(() => {})
})

suite('migrations against the real instance', () => {
  it('applies every migration file cleanly', async () => {
    // Idempotent: a second run over an up-to-date database is a no-op. A
    // migration that only works on an empty PGlite would fail here.
    await migrate(db, { migrationsFolder: './drizzle' })

    const [row] = await db
      .insert(schema.organizations)
      .values({ name: `neon-suite-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.organizations.id })

    orgId = row.id
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/)
  }, 120_000)
})

suite('interactive transactions over the pooled driver', () => {
  it('commits every statement together', async () => {
    const email = `tx-commit-${crypto.randomUUID().slice(0, 8)}@neon.test`

    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ organizationId: orgId, email, name: 'commit', passwordHash: 'x' })
        .returning({ id: schema.users.id })

      await tx
        .update(schema.users)
        .set({ name: 'renamed inside the transaction' })
        .where(eq(schema.users.id, user.id))
    })

    const [saved] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(saved?.name).toBe('renamed inside the transaction')
  }, 60_000)

  it('ROLLS BACK everything when a statement fails partway', async () => {
    // The property completing a signature depends on: it writes six rows, and a
    // failure in the middle must leave none of them. A driver that silently
    // auto-commits each statement would leave a signed file on an agreement
    // that still says "awaiting signature".
    const email = `tx-rollback-${crypto.randomUUID().slice(0, 8)}@neon.test`

    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(schema.users)
          .values({ organizationId: orgId, email, name: 'rolled back', passwordHash: 'x' })

        // Violates the foreign key — the same class of failure a real
        // completion would hit if a referenced row vanished.
        await tx.insert(schema.userSessions).values({
          userId: '00000000-0000-4000-8000-000000000000',
          sessionHash: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        })
      }),
    ).rejects.toThrow()

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(rows, 'the first insert must not have survived').toHaveLength(0)
  }, 60_000)

  it('rolls back on an explicit throw, not only on a database error', async () => {
    const email = `tx-throw-${crypto.randomUUID().slice(0, 8)}@neon.test`

    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(schema.users)
          .values({ organizationId: orgId, email, name: 'thrown', passwordHash: 'x' })
        throw new Error('application decided to abort')
      }),
    ).rejects.toThrow('application decided to abort')

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(rows).toHaveLength(0)
  }, 60_000)
})

suite('concurrency', () => {
  it('lets exactly one of two racing transactions win a unique constraint', async () => {
    // Two signers, or two tabs, submitting at the same moment. The unique index
    // on the email is standing in for the unique indexes that matter — a
    // signing token hash and an OTP challenge — because a duplicate there would
    // mean two live links for one document.
    const email = `race-${crypto.randomUUID().slice(0, 8)}@neon.test`

    const attempt = () =>
      db.transaction(async (tx) => {
        await tx
          .insert(schema.users)
          .values({ organizationId: orgId, email, name: 'race', passwordHash: 'x' })
      })

    const results = await Promise.allSettled([attempt(), attempt()])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(rows).toHaveLength(1)
  }, 60_000)

  it('serialises concurrent increments of the same rate-limit bucket', async () => {
    // The rate limiter is one atomic upsert precisely so that ten concurrent
    // requests cannot all read the same count and all write count+1, turning a
    // limit of five into a limit of fifty.
    const bucket = `neon-race:${crypto.randomUUID().slice(0, 8)}`
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
    const expiresAt = new Date(windowStart.getTime() + 60_000)

    const bump = () =>
      db
        .insert(schema.rateLimits)
        .values({ bucket, windowStart, expiresAt, count: 1 })
        .onConflictDoUpdate({
          target: [schema.rateLimits.bucket, schema.rateLimits.windowStart],
          set: { count: sql`${schema.rateLimits.count} + 1` },
        })

    await Promise.all(Array.from({ length: 10 }, bump))

    const [row] = await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.bucket, bucket))

    expect(row.count, 'every concurrent attempt must be counted').toBe(10)

    await db.delete(schema.rateLimits).where(eq(schema.rateLimits.bucket, bucket))
  }, 60_000)
})
