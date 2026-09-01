/**
 * Creates the first organization and its first admin. One-time, after the
 * first migration — every later account is created from the users screen.
 *
 *   DATABASE_URL=… npx tsx scripts/bootstrap-admin.ts <email> <phone> [name] [org]
 *
 * No password exists to choose or to hand over: the person logs in with the
 * phone number given here and a one-time SMS code.
 */
import { normalizeIsraeliPhone } from '../src/lib/phone'
import { getDb, schema } from '../src/server/db'

async function main() {
  const [email, phoneInput, name, orgName] = process.argv.slice(2)

  if (!email || !phoneInput) {
    console.error('usage: bootstrap-admin.ts <email> <phone> [name] [org]')
    process.exit(1)
  }

  const phone = normalizeIsraeliPhone(phoneInput)
  if (!phone) {
    console.error(`not a valid Israeli mobile number: ${phoneInput}`)
    process.exit(1)
  }

  const db = getDb()

  // One-time means one-time: a system that already has users does not get a
  // second bootstrap admin slipped into it from a shell.
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  if (existing.length > 0) {
    console.error('users already exist — create further accounts from the users screen')
    process.exit(1)
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: orgName ?? 'XTRA' })
    .returning({ id: schema.organizations.id })

  await db.insert(schema.users).values({
    organizationId: org.id,
    email: email.toLowerCase(),
    phone,
    name: name ?? email,
    role: 'admin',
    isAdmin: true,
  })

  console.log(`created admin ${email} (${phone}) in organization ${org.id}`)
  process.exit(0)
}

void main()
