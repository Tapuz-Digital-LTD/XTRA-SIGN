import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeIsraeliPhone } from '@/lib/phone'
import { getDb, schema } from '@/server/db'
import { requestLoginCode, verifyLoginCode } from '../login'
import { getSession } from '../session'

/**
 * The whole login, end to end against the real Postgres: a phone number goes
 * in, an SMS goes out (captured here), the code opens a session, and the
 * session cookie identifies the user — plus every way that must NOT work.
 */

// ── the two boundaries the flow crosses, faked in memory ────────────────────

/** What left the building. The code inside is the one a real phone would get. */
const sentSms: { to: string; text: string }[] = []

vi.mock('@/server/notifications/inforu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/notifications/inforu')>()
  return {
    ...actual,
    logOnlyMode: () => false,
    InforuSmsProvider: class {
      readonly channel = 'sms' as const
      isConfigured() {
        return true
      }
      async send(message: { to: string; text: string }) {
        sentSms.push({ to: message.to, text: message.text })
        return { ok: true as const, providerMessageId: 'test' }
      }
    },
  }
})

/** The browser's cookie jar, so createSession → getSession works in a test. */
const cookieJar = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
}))

function codeFromLastSms(): string {
  const last = sentSms.at(-1)
  if (!last) throw new Error('no SMS was sent')
  const match = /\b(\d{6})\b/.exec(last.text)
  if (!match) throw new Error(`no code in: ${last.text}`)
  return match[1]
}

// ── fixtures ────────────────────────────────────────────────────────────────

const db = getDb()

let orgId: string
let suffix: string
let phoneCounter = 0
let ipCounter = 0

function freshPhone(): string {
  phoneCounter += 1
  return `053${String(phoneCounter).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`
}

/** Each test gets its own IP so one test's rate limit cannot spill into another. */
function freshIp(): string {
  ipCounter += 1
  return `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`
}

async function seedUser(input: { phone: string; disabled?: boolean }) {
  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: orgId,
      email: `login-${suffix}-${phoneCounter}-${Math.floor(Math.random() * 1e6)}@xtra.test`,
      name: 'בודק',
      phone: normalizeIsraeliPhone(input.phone)!,
      disabledAt: input.disabled ? new Date() : null,
    })
    .returning({ id: schema.users.id, email: schema.users.email })
  return user
}

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `L ${suffix}` })
    .returning({ id: schema.organizations.id })
  orgId = org.id
})

beforeEach(() => {
  sentSms.length = 0
  cookieJar.clear()
})

afterAll(async () => {
  const users = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.organizationId, orgId))
  for (const u of users) {
    await db.delete(schema.loginChallenges).where(eq(schema.loginChallenges.userId, u.id))
    await db.delete(schema.userSessions).where(eq(schema.userSessions.userId, u.id))
  }
  await db.delete(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, orgId))
  await db.delete(schema.users).where(eq(schema.users.organizationId, orgId))
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId))
  await db.delete(schema.rateLimits).where(sql`${schema.rateLimits.bucket} like 'login%'`)
})

// ── the flow ────────────────────────────────────────────────────────────────

describe('phone → OTP → session', () => {
  it('logs a real user in, end to end', async () => {
    const phone = freshPhone()
    const user = await seedUser({ phone })
    const ip = freshIp()

    const requested = await requestLoginCode(phone, { ip })
    expect(requested).toMatchObject({ ok: true })
    expect(sentSms).toHaveLength(1)
    // The SMS goes to the national format InforU expects, and contains no
    // words about passwords because there are none.
    expect(sentSms[0].to).toBe(phone)

    const verified = await verifyLoginCode(phone, codeFromLastSms(), { ip })
    expect(verified).toMatchObject({ ok: true })

    // The cookie that was just set identifies exactly this user.
    const session = await getSession()
    expect(session?.userId).toBe(user.id)

    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
    expect(row.lastLoginAt).not.toBeNull()
  })

  it('accepts the number however it is typed', async () => {
    const phone = freshPhone()
    await seedUser({ phone })
    const ip = freshIp()

    // Request with dashes, verify with the international prefix — one account.
    const dashed = `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
    expect(await requestLoginCode(dashed, { ip })).toMatchObject({ ok: true })
    expect(
      await verifyLoginCode(`+972${phone.slice(1)}`, codeFromLastSms(), { ip }),
    ).toMatchObject({ ok: true })
  })

  it('makes a code single-use — a replay of the same code is refused', async () => {
    const phone = freshPhone()
    await seedUser({ phone })
    const ip = freshIp()

    await requestLoginCode(phone, { ip })
    const code = codeFromLastSms()

    expect(await verifyLoginCode(phone, code, { ip })).toMatchObject({ ok: true })
    expect(await verifyLoginCode(phone, code, { ip })).toMatchObject({ ok: false })
  })

  it('stores only a hash of the code, never the code', async () => {
    const phone = freshPhone()
    const user = await seedUser({ phone })

    await requestLoginCode(phone, { ip: freshIp() })
    const code = codeFromLastSms()

    const [challenge] = await db
      .select()
      .from(schema.loginChallenges)
      .where(eq(schema.loginChallenges.userId, user.id))
    expect(challenge.codeHash).not.toContain(code)
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── everything that must not work ───────────────────────────────────────────

describe('refusals', () => {
  it('answers a number that belongs to nobody EXACTLY like a real one — and sends nothing', async () => {
    const registered = freshPhone()
    await seedUser({ phone: registered })
    const stranger = freshPhone()

    const forReal = await requestLoginCode(registered, { ip: freshIp() })
    sentSms.length = 0
    const forStranger = await requestLoginCode(stranger, { ip: freshIp() })

    // Same ok, same sentence. The mask echoes the caller's own typing, so it
    // differs only where the input did; beyond it, the only difference in the
    // world is whether a phone buzzed — which the form cannot see.
    expect(forStranger).toEqual({ ...forReal, maskedDestination: expect.any(String) })
    expect(sentSms).toHaveLength(0)

    // And a code for a nonexistent account can never verify.
    expect(await verifyLoginCode(stranger, '123456', { ip: freshIp() })).toMatchObject({
      ok: false,
    })
  })

  it('sends nothing to a disabled account, with the same opaque answer', async () => {
    const phone = freshPhone()
    await seedUser({ phone, disabled: true })

    const result = await requestLoginCode(phone, { ip: freshIp() })
    expect(result).toMatchObject({ ok: true })
    expect(sentSms).toHaveLength(0)
  })

  it('locks out a user disabled AFTER their code was sent — holding a valid OTP is not enough', async () => {
    const phone = freshPhone()
    const user = await seedUser({ phone })
    const ip = freshIp()

    await requestLoginCode(phone, { ip })
    const code = codeFromLastSms()

    // The admin pulls the plug between the SMS arriving and the code being
    // typed in.
    await db
      .update(schema.users)
      .set({ disabledAt: new Date() })
      .where(eq(schema.users.id, user.id))

    expect(await verifyLoginCode(phone, code, { ip })).toMatchObject({ ok: false })
    expect(await getSession()).toBeNull()
  })

  it('refuses a wrong code and counts the attempt', async () => {
    const phone = freshPhone()
    const user = await seedUser({ phone })
    const ip = freshIp()

    await requestLoginCode(phone, { ip })

    expect(await verifyLoginCode(phone, '000000', { ip })).toMatchObject({ ok: false })
    expect(await getSession()).toBeNull()

    const [challenge] = await db
      .select()
      .from(schema.loginChallenges)
      .where(eq(schema.loginChallenges.userId, user.id))
    expect(challenge.attempts).toBe(1)

    // The real code still works after a stranger's bad guess.
    expect(await verifyLoginCode(phone, codeFromLastSms(), { ip })).toMatchObject({ ok: true })
  })

  it('refuses a code that has expired', async () => {
    const phone = freshPhone()
    const user = await seedUser({ phone })
    const ip = freshIp()

    await requestLoginCode(phone, { ip })
    const code = codeFromLastSms()

    await db
      .update(schema.loginChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.loginChallenges.userId, user.id))

    expect(await verifyLoginCode(phone, code, { ip })).toMatchObject({ ok: false })
  })

  it('rate limits by phone number across request AND verify', async () => {
    const phone = freshPhone()
    await seedUser({ phone })

    // Five consumptions from five different IPs, so only the per-number bucket
    // can be the one that trips.
    await requestLoginCode(phone, { ip: freshIp() })
    for (let i = 0; i < 4; i++) {
      await verifyLoginCode(phone, '000000', { ip: freshIp() })
    }

    const sixth = await verifyLoginCode(phone, codeFromLastSms(), { ip: freshIp() })
    expect(sixth).toMatchObject({ ok: false, message: expect.stringContaining('יותר מדי') })
  })

  it('rate limits by IP across different numbers', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i++) {
      await requestLoginCode(freshPhone(), { ip })
    }

    const phone = freshPhone()
    await seedUser({ phone })
    const sixth = await requestLoginCode(phone, { ip })
    expect(sixth).toMatchObject({ ok: false, message: expect.stringContaining('יותר מדי') })
    expect(sentSms).toHaveLength(0)
  })

  it('refuses a malformed number without touching the database', async () => {
    expect(await requestLoginCode('abc', { ip: freshIp() })).toMatchObject({ ok: false })
    expect(await requestLoginCode('03-5551234', { ip: freshIp() })).toMatchObject({ ok: false })
  })
})
