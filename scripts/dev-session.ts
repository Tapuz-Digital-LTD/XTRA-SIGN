/** Dev-only: mints a login session for the first user and prints the raw cookie token. */
import { getDb, schema } from '../src/server/db'
import { generateToken, hashToken } from '../src/server/auth/tokens'

async function main() {
  const db = getDb()
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  if (!user) throw new Error('no user')
  const token = generateToken()
  await db.insert(schema.userSessions).values({
    userId: user.id,
    sessionHash: hashToken(token),
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
  })
  console.log(token)
  process.exit(0)
}
void main()
