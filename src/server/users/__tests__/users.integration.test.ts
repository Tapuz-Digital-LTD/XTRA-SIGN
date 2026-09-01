import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { hashToken } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import {
  NotAdminError,
  createUser,
  listUsers,
  setUserDisabled,
  setUserRole,
  updateUser,
} from '../users'

/** Against the real Postgres. */

const db = getDb()

let orgId: string
let otherOrgId: string
let admin: StaffSession
let plain: StaffSession
let suffix: string
let phoneCounter = 0

/** Unique across every test in the run: the phone column is globally unique. */
function freshPhone(): string {
  phoneCounter += 1
  return `05${String(phoneCounter).padStart(2, '0')}${suffix.replace(/\D/g, '9').slice(0, 2)}${String(
    Math.floor(Math.random() * 10_000),
  ).padStart(4, '0')}`
}

const sentEmails: { to: string; text: string }[] = []

vi.mock('@/server/notifications/inforu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/notifications/inforu')>()
  return {
    ...actual,
    InforuEmailProvider: class {
      readonly channel = 'email' as const
      isConfigured() {
        return true
      }
      async send(message: { to: string; text: string }) {
        sentEmails.push({ to: message.to, text: message.text })
        return { ok: true as const, providerMessageId: 'test' }
      }
    },
  }
})

beforeAll(async () => {
  suffix = crypto.randomUUID().slice(0, 8)
  process.env.SIGN_PUBLIC_URL = 'https://sign.test'

  const [org] = await db.insert(schema.organizations).values({ name: `U ${suffix}` }).returning({ id: schema.organizations.id })
  const [other] = await db.insert(schema.organizations).values({ name: `O ${suffix}` }).returning({ id: schema.organizations.id })
  orgId = org.id
  otherOrgId = other.id

  const mk = async (organizationId: string, email: string, isAdmin: boolean): Promise<StaffSession> => {
    const [u] = await db
      .insert(schema.users)
      .values({
        organizationId, email, name: email, phone: normalizeIsraeliPhone(freshPhone())!,
        role: isAdmin ? 'admin' : 'user', isAdmin,
      })
      .returning({ id: schema.users.id })
    return { userId: u.id, organizationId, email, name: email, isAdmin }
  }

  admin = await mk(orgId, `admin-${suffix}@xtra.test`, true)
  plain = await mk(orgId, `user-${suffix}@xtra.test`, false)
})

beforeEach(() => {
  sentEmails.length = 0
})

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) {
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.organizationId, id))
    for (const u of users) {
      await db.delete(schema.loginChallenges).where(eq(schema.loginChallenges.userId, u.id))
      await db.delete(schema.userSessions).where(eq(schema.userSessions.userId, u.id))
    }
    await db.delete(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, id))
    await db.delete(schema.users).where(eq(schema.users.organizationId, id))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, id))
  }
  await db.delete(schema.rateLimits).where(sql`${schema.rateLimits.bucket} like 'userCreate%' or ${schema.rateLimits.bucket} like 'login%'`)
})

describe('permissions', () => {
  it('REFUSES a non-admin every admin action', async () => {
    await expect(listUsers(plain)).rejects.toBeInstanceOf(NotAdminError)
    await expect(
      createUser({ session: plain, email: 'x@y.com', name: 'x', phone: '0521112233', role: 'user' }),
    ).rejects.toBeInstanceOf(NotAdminError)
    await expect(
      updateUser({ session: plain, userId: admin.userId, email: 'x@y.com', name: 'x', phone: '0521112233' }),
    ).rejects.toBeInstanceOf(NotAdminError)
    await expect(
      setUserDisabled({ session: plain, userId: admin.userId, disabled: true }),
    ).rejects.toBeInstanceOf(NotAdminError)
    await expect(
      setUserRole({ session: plain, userId: admin.userId, role: 'admin' }),
    ).rejects.toBeInstanceOf(NotAdminError)
  })

  it('scopes an admin to their own organization', async () => {
    const outsider = await db
      .insert(schema.users)
      .values({ organizationId: otherOrgId, email: `out-${suffix}@x.test`, name: 'out', phone: normalizeIsraeliPhone(freshPhone())! })
      .returning({ id: schema.users.id })

    // An admin is an admin of their tenant, never globally.
    const disable = await setUserDisabled({ session: admin, userId: outsider[0].id, disabled: true })
    expect(disable).toMatchObject({ ok: false })

    const edit = await updateUser({
      session: admin, userId: outsider[0].id,
      email: `out-${suffix}@x.test`, name: 'renamed', phone: freshPhone(),
    })
    expect(edit).toMatchObject({ ok: false })

    const listed = await listUsers(admin)
    expect(listed.map((u) => u.email)).not.toContain(`out-${suffix}@x.test`)
  })

  it('will not let an admin lock themselves out', async () => {
    expect(await setUserDisabled({ session: admin, userId: admin.userId, disabled: true })).toMatchObject({ ok: false })
    expect(await setUserRole({ session: admin, userId: admin.userId, role: 'user' })).toMatchObject({ ok: false })
  })
})

describe('creating users', () => {
  it('creates an account that is usable immediately — nothing to accept, nothing to set', async () => {
    const email = `created-${suffix}@xtra.test`
    const phone = freshPhone()

    const result = await createUser({ session: admin, email, name: 'חדש', phone, role: 'user' })
    expect(result).toMatchObject({ ok: true })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    // Stored in the one canonical E.164 form, whatever way it was typed.
    expect(user.phone).toBe(normalizeIsraeliPhone(phone))
    expect(user.disabledAt).toBeNull()

    // The welcome email tells them how to get in. It must never contain a
    // password, a code, or any other secret — the phone is the way in.
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe(email)
    expect(sentEmails[0].text).not.toMatch(/סיסמה|password/i)
  })

  it('normalizes the phone before storing it', async () => {
    const email = `intl-${suffix}@xtra.test`
    const raw = freshPhone()
    const international = `+972${raw.slice(1)}`

    expect(await createUser({ session: admin, email, name: 'בינלאומי', phone: international, role: 'user' })).toMatchObject({ ok: true })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    // One canonical form, so the same SIM cannot become two accounts.
    expect(user.phone).toBe(normalizeIsraeliPhone(raw))
  })

  it('REFUSES a duplicate email and a duplicate phone, each with its own sentence', async () => {
    const email = `dup-${suffix}@xtra.test`
    const phone = freshPhone()
    await createUser({ session: admin, email, name: 'ראשון', phone, role: 'user' })

    const sameEmail = await createUser({ session: admin, email, name: 'שני', phone: freshPhone(), role: 'user' })
    expect(sameEmail).toMatchObject({ ok: false, message: expect.stringContaining('אימייל') })

    const samePhone = await createUser({ session: admin, email: `dup2-${suffix}@xtra.test`, name: 'שלישי', phone, role: 'user' })
    expect(samePhone).toMatchObject({ ok: false, message: expect.stringContaining('טלפון') })
  })

  it('REFUSES a number that could never receive the login SMS', async () => {
    const result = await createUser({
      session: admin, email: `landline-${suffix}@xtra.test`, name: 'קווי',
      phone: '03-5551234', role: 'user',
    })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('editing users', () => {
  it('changes name, email and phone', async () => {
    const email = `edit-${suffix}@xtra.test`
    await createUser({ session: admin, email, name: 'לפני', phone: freshPhone(), role: 'user' })
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))

    const newPhone = freshPhone()
    const result = await updateUser({
      session: admin, userId: user.id,
      email: `edited-${suffix}@xtra.test`, name: 'אחרי', phone: newPhone,
    })
    expect(result).toMatchObject({ ok: true })

    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
    expect(updated).toMatchObject({
      email: `edited-${suffix}@xtra.test`,
      name: 'אחרי',
      phone: normalizeIsraeliPhone(newPhone),
    })
  })

  it('REFUSES moving a user onto a phone number someone else logs in with', async () => {
    const first = `steal-a-${suffix}@xtra.test`
    const second = `steal-b-${suffix}@xtra.test`
    const firstPhone = freshPhone()
    await createUser({ session: admin, email: first, name: 'א', phone: firstPhone, role: 'user' })
    await createUser({ session: admin, email: second, name: 'ב', phone: freshPhone(), role: 'user' })

    const [victim] = await db.select().from(schema.users).where(eq(schema.users.email, second))
    const result = await updateUser({ session: admin, userId: victim.id, email: second, name: 'ב', phone: firstPhone })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('טלפון') })
  })
})

describe('disabling', () => {
  it('revokes every live session immediately', async () => {
    const email = `kill-${suffix}@xtra.test`
    await createUser({ session: admin, email, name: 'ניתוק', phone: freshPhone(), role: 'user' })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    await db.insert(schema.userSessions).values({
      userId: user.id,
      sessionHash: hashToken(`session-${suffix}-kill`),
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    await setUserDisabled({ session: admin, userId: user.id, disabled: true })

    // Waiting for a 12-hour TTL means a disabled account works for the rest
    // of the day.
    const sessions = await db.select().from(schema.userSessions).where(eq(schema.userSessions.userId, user.id))
    expect(sessions).toHaveLength(0)
  })

  it('can be undone', async () => {
    const email = `undo-${suffix}@xtra.test`
    await createUser({ session: admin, email, name: 'החזרה', phone: freshPhone(), role: 'user' })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    await setUserDisabled({ session: admin, userId: user.id, disabled: true })
    expect((await listUsers(admin)).find((u) => u.email === email)?.disabled).toBe(true)

    await setUserDisabled({ session: admin, userId: user.id, disabled: false })
    expect((await listUsers(admin)).find((u) => u.email === email)?.disabled).toBe(false)
  })
})
