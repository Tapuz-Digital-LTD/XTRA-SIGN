import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { hashToken, verifyPassword } from '@/server/auth/tokens'
import {
  NotAdminError,
  acceptInvitation,
  completePasswordReset,
  inviteUser,
  listUsers,
  requestPasswordReset,
  resolveInvitation,
  setUserDisabled,
  setUserRole,
  validatePassword,
} from '../users'

/** Against the real Postgres. */

const db = getDb()

let orgId: string
let otherOrgId: string
let admin: StaffSession
let plain: StaffSession
let suffix: string

/**
 * The invitation email carries the only copy of the token; the database keeps
 * a hash. Capturing what the provider was handed is how a test can then use
 * the link, exactly as a recipient would.
 */
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

function tokenFromLastEmail(): string {
  const last = sentEmails.at(-1)
  if (!last) throw new Error('no email was sent')
  const match = /\/(?:invite|reset-password)\/([A-Za-z0-9_-]+)/.exec(last.text)
  if (!match) throw new Error(`no token in: ${last.text}`)
  return match[1]
}

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
        organizationId, email, name: email,
        passwordHash: 'scrypt$00$00', role: isAdmin ? 'admin' : 'user', isAdmin,
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
      await db.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, u.id))
      await db.delete(schema.userSessions).where(eq(schema.userSessions.userId, u.id))
    }
    await db.delete(schema.invitations).where(eq(schema.invitations.organizationId, id))
    await db.delete(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.organizationId, id))
    await db.delete(schema.users).where(eq(schema.users.organizationId, id))
    await db.delete(schema.organizations).where(eq(schema.organizations.id, id))
  }
  await db.delete(schema.rateLimits).where(sql`${schema.rateLimits.bucket} like 'invite%' or ${schema.rateLimits.bucket} like 'forgot%' or ${schema.rateLimits.bucket} like 'login%'`)
})

describe('permissions', () => {
  it('REFUSES a non-admin every admin action', async () => {
    await expect(listUsers(plain)).rejects.toBeInstanceOf(NotAdminError)
    await expect(
      inviteUser({ session: plain, email: 'x@y.com', name: 'x', role: 'user' }),
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
      .values({ organizationId: otherOrgId, email: `out-${suffix}@x.test`, name: 'out', passwordHash: 'x' })
      .returning({ id: schema.users.id })

    // An admin is an admin of their tenant, never globally.
    const result = await setUserDisabled({ session: admin, userId: outsider[0].id, disabled: true })
    expect(result).toMatchObject({ ok: false })

    const listed = await listUsers(admin)
    expect(listed.map((u) => u.email)).not.toContain(`out-${suffix}@x.test`)
  })

  it('will not let an admin lock themselves out', async () => {
    expect(await setUserDisabled({ session: admin, userId: admin.userId, disabled: true })).toMatchObject({ ok: false })
    expect(await setUserRole({ session: admin, userId: admin.userId, role: 'user' })).toMatchObject({ ok: false })
  })
})

describe('invitations', () => {
  it('creates a user with NO password and emails a link, never a password', async () => {
    const email = `invited-${suffix}@xtra.test`
    const result = await inviteUser({ session: admin, email, name: 'מוזמן', role: 'user' })
    expect(result).toMatchObject({ ok: true })

    const body = sentEmails.at(-1)!.text
    expect(body).toContain('/invite/')

    // The real property, rather than grepping the wording: at this point no
    // password exists anywhere to have been emailed. One is only created when
    // the invited person chooses it.
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(rows.every((row) => row.passwordHash === null)).toBe(true)

    const listed = await listUsers(admin)
    // The account does not appear in the list until the invitation is accepted.
    expect(listed.map((u) => u.email)).not.toContain(email)
  })

  it('stores only the hash of the invitation token', async () => {
    await inviteUser({ session: admin, email: `hash-${suffix}@xtra.test`, name: 'ח', role: 'user' })
    const token = tokenFromLastEmail()

    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, `hash-${suffix}@xtra.test`))

    expect(row.tokenHash).not.toBe(token)
    expect(row.tokenHash).toBe(hashToken(token))
  })

  it('accepts an invitation and sets the password the person chose', async () => {
    const email = `accept-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'מקבל', role: 'user' })
    const token = tokenFromLastEmail()

    expect(await resolveInvitation(token)).toMatchObject({ email, role: 'user' })

    const result = await acceptInvitation({ token, password: 'a-good-passphrase-9' })
    expect(result).toMatchObject({ ok: true })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    expect(user.passwordHash).toBeTruthy()
    expect(await verifyPassword('a-good-passphrase-9', user.passwordHash!)).toBe(true)
  })

  it('is single-use — a replayed link creates nothing', async () => {
    const email = `once-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'פעם', role: 'user' })
    const token = tokenFromLastEmail()

    expect(await acceptInvitation({ token, password: 'first-password-123' })).toMatchObject({ ok: true })
    expect(await acceptInvitation({ token, password: 'second-password-123' })).toMatchObject({ ok: false })
    expect(await resolveInvitation(token)).toBeNull()
  })

  it('does not resolve an expired or unknown token', async () => {
    for (const bad of ['', 'short', 'x'.repeat(43)]) {
      expect(await resolveInvitation(bad)).toBeNull()
    }

    await inviteUser({ session: admin, email: `exp-${suffix}@xtra.test`, name: 'פג', role: 'user' })
    const token = tokenFromLastEmail()
    await db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.tokenHash, hashToken(token)))

    expect(await resolveInvitation(token)).toBeNull()
  })

  it('revokes an earlier invitation when a second is sent', async () => {
    const email = `resend-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'שוב', role: 'user' })
    const first = tokenFromLastEmail()

    await inviteUser({ session: admin, email, name: 'שוב', role: 'user' })
    const second = tokenFromLastEmail()

    // The newest link is the one that works, which is what a recipient assumes.
    expect(await resolveInvitation(first)).toBeNull()
    expect(await resolveInvitation(second)).not.toBeNull()
  })

  it('records who invited whom', async () => {
    await inviteUser({ session: admin, email: `audit-${suffix}@xtra.test`, name: 'א', role: 'admin' })
    const events = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.organizationId, orgId))
    const invite = events.find((e) => e.targetEmail === `audit-${suffix}@xtra.test`)
    expect(invite?.type).toBe('user_invited')
    expect(invite?.actorEmail).toBe(admin.email)
  })
})

describe('passwords', () => {
  it('refuses short and obvious passwords', () => {
    expect(validatePassword('short')).toBeTruthy()
    expect(validatePassword('password123')).toBeTruthy()
    expect(validatePassword('a-perfectly-fine-one')).toBeNull()
  })

  it('reveals nothing about whether an address exists', async () => {
    // Both return void and send nothing the caller can distinguish.
    await expect(requestPasswordReset({ email: `nobody-${suffix}@nowhere.test` })).resolves.toBeUndefined()
    expect(sentEmails).toHaveLength(0)
  })

  it('resets a password and kills every existing session', async () => {
    const email = `reset-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'איפוס', role: 'user' })
    await acceptInvitation({ token: tokenFromLastEmail(), password: 'original-password-1' })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    await db.insert(schema.userSessions).values({
      userId: user.id,
      sessionHash: hashToken(`live-session-${suffix}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    sentEmails.length = 0
    await requestPasswordReset({ email })
    const token = tokenFromLastEmail()

    expect(await completePasswordReset({ token, password: 'a-brand-new-password' })).toMatchObject({ ok: true })

    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
    expect(await verifyPassword('a-brand-new-password', updated.passwordHash!)).toBe(true)

    // If the reset happened because someone else had the account, leaving
    // their session alive defeats the point.
    const sessions = await db.select().from(schema.userSessions).where(eq(schema.userSessions.userId, user.id))
    expect(sessions).toHaveLength(0)
  })

  it('makes a reset token single-use', async () => {
    const email = `once-reset-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'פעם', role: 'user' })
    await acceptInvitation({ token: tokenFromLastEmail(), password: 'first-password-999' })

    sentEmails.length = 0
    await requestPasswordReset({ email })
    const token = tokenFromLastEmail()

    expect(await completePasswordReset({ token, password: 'second-password-999' })).toMatchObject({ ok: true })
    expect(await completePasswordReset({ token, password: 'third-password-999' })).toMatchObject({ ok: false })
  })

  it('sends nothing to a disabled account', async () => {
    const email = `disabled-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'מושבת', role: 'user' })
    await acceptInvitation({ token: tokenFromLastEmail(), password: 'a-valid-password-1' })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    await setUserDisabled({ session: admin, userId: user.id, disabled: true })

    sentEmails.length = 0
    await requestPasswordReset({ email })
    expect(sentEmails).toHaveLength(0)
  })
})

describe('disabling', () => {
  it('revokes every live session immediately', async () => {
    const email = `kill-${suffix}@xtra.test`
    await inviteUser({ session: admin, email, name: 'ניתוק', role: 'user' })
    await acceptInvitation({ token: tokenFromLastEmail(), password: 'a-valid-password-2' })

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
    await inviteUser({ session: admin, email, name: 'החזרה', role: 'user' })
    await acceptInvitation({ token: tokenFromLastEmail(), password: 'a-valid-password-3' })

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    await setUserDisabled({ session: admin, userId: user.id, disabled: true })
    expect((await listUsers(admin)).find((u) => u.email === email)?.disabled).toBe(true)

    await setUserDisabled({ session: admin, userId: user.id, disabled: false })
    expect((await listUsers(admin)).find((u) => u.email === email)?.disabled).toBe(false)
  })
})
