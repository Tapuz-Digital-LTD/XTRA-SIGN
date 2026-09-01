/**
 * Creates an organization and a staff user for local development.
 *   npx tsx --env-file=.env.local scripts/seed-user.ts <email> <password> [name] [org]
 */
import { getDb, schema } from '../src/server/db'
import { hashPassword } from '../src/server/auth/tokens'

async function main() {
  const [email, password, name, orgName] = process.argv.slice(2)

  if (!email || !password) {
    console.error('usage: seed-user.ts <email> <password> [name] [org]')
    process.exit(1)
  }

  const db = getDb()

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: orgName ?? 'XTRA' })
    .returning({ id: schema.organizations.id })

  await db.insert(schema.users).values({
    organizationId: org.id,
    email: email.toLowerCase(),
    name: name ?? email,
    passwordHash: await hashPassword(password),
    role: 'admin',
    isAdmin: true,
  })

  console.log(`created admin ${email} in organization ${org.id}`)
  process.exit(0)
}

void main()
