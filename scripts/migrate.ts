/**
 * Applies pending migrations, then exits.
 *
 * Run explicitly and never as part of a build. A build runs on every push and
 * on every Preview deployment; wiring migrations into it means a branch someone
 * opened for an experiment can alter the live schema, and two concurrent
 * deploys can race each other through it.
 *
 *   npm run db:migrate
 *
 * The target host and database are printed before anything runs, so pointing at
 * the wrong one is visible rather than discovered afterwards.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url)
    // Host and database only — never the credentials.
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return 'unparseable DATABASE_URL'
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. Use one of the db:migrate:* scripts.')
    process.exit(1)
  }

  console.log(`Applying migrations to: ${describeTarget(url)}`)

  // max: 1 — a migration runner needs exactly one connection, and the migrator's
  // advisory lock is per-connection.
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
    console.log('Migrations applied.')
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error)
    await pool.end().catch(() => {})
    process.exit(1)
  }
}

void main()
