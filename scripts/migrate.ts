/**
 * Applies pending migrations, then exits.
 *
 * Runs as its own one-off task rather than on app startup: several web tasks
 * starting at once would each try to migrate, and a failed migration inside a
 * starting container looks like a crash loop instead of a clear failure.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(JSON.stringify({ level: 'error', msg: 'DATABASE_URL is not set' }))
    process.exit(1)
  }

  // max: 1 — a migration runner needs exactly one connection, and Postgres
  // advisory locks in the migrator are per-connection.
  const sql = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
    console.log(JSON.stringify({ level: 'info', msg: 'migrations applied' }))
    await sql.end()
    process.exit(0)
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'migration failed', error: String(error) }))
    await sql.end().catch(() => {})
    process.exit(1)
  }
}

void main()
