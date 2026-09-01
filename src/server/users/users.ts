import { and, eq, isNull, gt, desc } from 'drizzle-orm'
import { AUDIT_EVENTS } from './admin-audit'
import { generateToken, hashPassword, hashToken, verifyPassword } from '@/server/auth/tokens'
import { destroySession, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { consume } from '@/server/http/rate-limit'
import { log } from '@/server/log'
import { InforuEmailProvider } from '@/server/notifications/inforu'
import { recordAdminAction } from './admin-audit'

/**
 * Staff accounts.
 *
 * There is no public signup. An account exists only because an admin created
 * it, and it has no password until the invited person sets one — a password is
 * never generated for someone and never sent by email, because an emailed
 * password lives in that mailbox forever.
 */

const INVITE_TTL_MS = 72 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000
const MIN_PASSWORD_LENGTH = 10

/**
 * Passwords that a length rule alone would accept.
 *
 * Deliberately short and obvious rather than a downloaded corpus: this catches
 * the handful someone actually types when told "at least 10 characters", and a
 * 100k-entry list is a dependency and a lookup for marginal gain.
 */
const OBVIOUS_PASSWORDS = [
  'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop',
  'xtrasign123', 'xtra123456', 'aaaaaaaaaa', 'letmein123', 'welcome123',
  'admin12345', 'changeme12',
]

export type UserRole = 'admin' | 'user'

export class NotAdminError extends Error {
  readonly status = 403
  constructor() {
    super('forbidden')
  }
}

function requireAdmin(session: StaffSession): void {
  if (!session.isAdmin) throw new NotAdminError()
}

export function validatePassword(password: string): string | null {
  const value = (password ?? '').normalize('NFKC')
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`
  }
  if (value.length > 200) return 'הסיסמה ארוכה מדי.'
  if (OBVIOUS_PASSWORDS.includes(value.toLowerCase())) {
    return 'הסיסמה נפוצה מדי. בחרו סיסמה אחרת.'
  }
  return null
}

// ── listing ────────────────────────────────────────────────────────────────

export type UserRow = {
  id: string
  email: string
  name: string
  role: UserRole
  disabled: boolean
  pending: boolean
  lastLoginAt: Date | null
}

export async function listUsers(session: StaffSession): Promise<UserRow[]> {
  requireAdmin(session)

  const rows = await getDb()
    .select()
    .from(schema.users)
    // Scoped to the admin's own organization. An admin is an admin of their
    // tenant, never globally.
    .where(eq(schema.users.organizationId, session.organizationId))
    .orderBy(schema.users.name)

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: Boolean(row.disabledAt),
    // No password yet means the invitation has not been accepted.
    pending: !row.passwordHash,
    lastLoginAt: row.lastLoginAt,
  }))
}

// ── invite ─────────────────────────────────────────────────────────────────

export type InviteResult = { ok: true } | { ok: false; message: string }

export async function inviteUser(input: {
  session: StaffSession
  email: string
  name: string
  role: UserRole
  ip?: string | null
}): Promise<InviteResult> {
  requireAdmin(input.session)

  const email = input.email.trim().toLowerCase()
  const name = input.name.trim().slice(0, 120)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'כתובת האימייל אינה תקינה.' }
  }
  if (!name) return { ok: false, message: 'יש להזין שם.' }

  const gate = await consume('inviteCreate', input.session.organizationId)
  if (!gate.allowed) return { ok: false, message: 'נשלחו יותר מדי הזמנות. נסו שוב מאוחר יותר.' }

  const db = getDb()

  const [existing] = await db
    .select({ id: schema.users.id, hasPassword: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing?.hasPassword) {
    return { ok: false, message: 'המשתמש כבר קיים במערכת.' }
  }

  // A second invitation to the same address replaces the first: the newest
  // link is the one that works, which is what the recipient assumes.
  await db
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invitations.email, email), isNull(schema.invitations.acceptedAt)))

  const token = generateToken()
  await db.insert(schema.invitations).values({
    organizationId: input.session.organizationId,
    email,
    name,
    role: input.role,
    tokenHash: hashToken(token),
    invitedBy: input.session.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })

  const base = (process.env.SIGN_PUBLIC_URL ?? '').replace(/\/+$/, '')
  const sent = await new InforuEmailProvider().send({
    to: email,
    subject: 'הזמנה ל-XTRA SIGN',
    text: `שלום ${name}, הוזמנת להשתמש ב-XTRA SIGN. להגדרת סיסמה: ${base}/invite/${token}`,
    html: inviteHtml(name, `${base}/invite/${token}`),
    recipientName: name,
  })

  await recordAdminAction({
    organizationId: input.session.organizationId,
    type: AUDIT_EVENTS.USER_INVITED,
    actorEmail: input.session.email,
    targetEmail: email,
    ip: input.ip,
    metadata: { role: input.role, delivered: sent.ok },
  })

  if (!sent.ok) {
    // The invitation exists either way; saying it was sent when it was not
    // leaves an admin waiting for someone who never got an email.
    return { ok: false, message: 'ההזמנה נוצרה אך שליחת המייל נכשלה. נסו לשלוח שוב.' }
  }

  return { ok: true }
}

export type PendingInvite = { email: string; name: string; role: UserRole }

/** Resolves an invitation token, or null for unknown/expired/used/revoked. */
export async function resolveInvitation(token: string): Promise<PendingInvite | null> {
  if (!token || token.length < 20 || token.length > 200) return null

  const [row] = await getDb()
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.tokenHash, hashToken(token)),
        gt(schema.invitations.expiresAt, new Date()),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    )
    .limit(1)

  return row ? { email: row.email, name: row.name, role: row.role } : null
}

export async function acceptInvitation(input: {
  token: string
  password: string
  ip?: string | null
}): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const gate = await consume('inviteAccept', hashToken(input.token).slice(0, 32))
  if (!gate.allowed) return { ok: false, message: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' }

  const invalid = validatePassword(input.password)
  if (invalid) return { ok: false, message: invalid }

  const db = getDb()
  const [invitation] = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.tokenHash, hashToken(input.token)),
        gt(schema.invitations.expiresAt, new Date()),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    )
    .limit(1)

  if (!invitation) return { ok: false, message: 'ההזמנה אינה בתוקף. בקשו הזמנה חדשה.' }

  const passwordHash = await hashPassword(input.password)

  const userId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, invitation.email))
      .limit(1)

    let id: string
    if (existing) {
      await tx
        .update(schema.users)
        .set({
          passwordHash,
          name: invitation.name,
          role: invitation.role,
          isAdmin: invitation.role === 'admin',
          disabledAt: null,
        })
        .where(eq(schema.users.id, existing.id))
      id = existing.id
    } else {
      const [created] = await tx
        .insert(schema.users)
        .values({
          organizationId: invitation.organizationId,
          email: invitation.email,
          name: invitation.name,
          passwordHash,
          role: invitation.role,
          isAdmin: invitation.role === 'admin',
        })
        .returning({ id: schema.users.id })
      id = created.id
    }

    // Marked used inside the same transaction, so a double submit cannot
    // create two accounts from one invitation.
    await tx
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, invitation.id))

    return id
  })

  await recordAdminAction({
    organizationId: invitation.organizationId,
    type: AUDIT_EVENTS.INVITATION_ACCEPTED,
    actorEmail: invitation.email,
    targetEmail: invitation.email,
    ip: input.ip,
  })

  return { ok: true, userId }
}

// ── disable / role ─────────────────────────────────────────────────────────

export async function setUserDisabled(input: {
  session: StaffSession
  userId: string
  disabled: boolean
  ip?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  requireAdmin(input.session)

  // An admin locking themselves out leaves an organization with no way in.
  if (input.userId === input.session.userId && input.disabled) {
    return { ok: false, message: 'לא ניתן להשבית את המשתמש שלך.' }
  }

  const db = getDb()
  const [target] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, input.userId),
        eq(schema.users.organizationId, input.session.organizationId),
      ),
    )
    .limit(1)

  if (!target) return { ok: false, message: 'המשתמש לא נמצא.' }

  await db
    .update(schema.users)
    .set({ disabledAt: input.disabled ? new Date() : null })
    .where(eq(schema.users.id, target.id))

  if (input.disabled) {
    // Every live session ends immediately. Waiting for a 12-hour TTL to expire
    // means a disabled account keeps working for the rest of the day.
    await db.delete(schema.userSessions).where(eq(schema.userSessions.userId, target.id))
    log.info('user disabled, sessions revoked', { targetEmail: target.email })
  }

  await recordAdminAction({
    organizationId: input.session.organizationId,
    type: input.disabled ? AUDIT_EVENTS.USER_DISABLED : AUDIT_EVENTS.USER_ENABLED,
    actorEmail: input.session.email,
    targetEmail: target.email,
    ip: input.ip,
  })

  return { ok: true }
}

export async function setUserRole(input: {
  session: StaffSession
  userId: string
  role: UserRole
  ip?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  requireAdmin(input.session)

  if (input.userId === input.session.userId && input.role !== 'admin') {
    return { ok: false, message: 'לא ניתן להסיר את הרשאת הניהול מעצמך.' }
  }

  const db = getDb()
  const [target] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, input.userId),
        eq(schema.users.organizationId, input.session.organizationId),
      ),
    )
    .limit(1)

  if (!target) return { ok: false, message: 'המשתמש לא נמצא.' }

  await db
    .update(schema.users)
    .set({ role: input.role, isAdmin: input.role === 'admin' })
    .where(eq(schema.users.id, target.id))

  await recordAdminAction({
    organizationId: input.session.organizationId,
    type: AUDIT_EVENTS.USER_ROLE_CHANGED,
    actorEmail: input.session.email,
    targetEmail: target.email,
    ip: input.ip,
    metadata: { role: input.role },
  })

  return { ok: true }
}

// ── password reset ─────────────────────────────────────────────────────────

/**
 * Always reports success.
 *
 * Telling the caller whether the address exists turns this form into an
 * account-enumeration oracle, which is how an attacker builds the list they
 * then run against the login form.
 */
export async function requestPasswordReset(input: {
  email: string
  ip?: string | null
}): Promise<void> {
  const email = input.email.trim().toLowerCase()

  const gate = await consume('forgotPassword', hashToken(email).slice(0, 32))
  if (!gate.allowed) return

  const db = getDb()
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      organizationId: schema.users.organizationId,
      disabledAt: schema.users.disabledAt,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  // A disabled account, or one that never accepted its invitation, gets
  // nothing — silently, for the same reason.
  if (!user || user.disabledAt || !user.passwordHash) return

  const token = generateToken()
  await db.insert(schema.passwordResets).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  })

  const base = (process.env.SIGN_PUBLIC_URL ?? '').replace(/\/+$/, '')
  await new InforuEmailProvider().send({
    to: email,
    subject: 'איפוס סיסמה ל-XTRA SIGN',
    text: `לאיפוס הסיסמה: ${base}/reset-password/${token} — הקישור בתוקף לשעה אחת.`,
    html: resetHtml(user.name, `${base}/reset-password/${token}`),
    recipientName: user.name,
  })

  await recordAdminAction({
    organizationId: user.organizationId,
    type: AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
    actorEmail: email,
    targetEmail: email,
    ip: input.ip,
  })
}

export async function completePasswordReset(input: {
  token: string
  password: string
  ip?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validatePassword(input.password)
  if (invalid) return { ok: false, message: invalid }

  const db = getDb()
  const [reset] = await db
    .select()
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.tokenHash, hashToken(input.token)),
        gt(schema.passwordResets.expiresAt, new Date()),
        isNull(schema.passwordResets.consumedAt),
      ),
    )
    .limit(1)

  if (!reset) return { ok: false, message: 'הקישור אינו בתוקף. בקשו קישור חדש.' }

  const passwordHash = await hashPassword(input.password)

  const [user] = await db
    .select({ email: schema.users.email, organizationId: schema.users.organizationId })
    .from(schema.users)
    .where(eq(schema.users.id, reset.userId))
    .limit(1)

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, reset.userId))

    await tx
      .update(schema.passwordResets)
      .set({ consumedAt: new Date() })
      .where(eq(schema.passwordResets.id, reset.id))

    // A password change ends every existing session. If the reset happened
    // because someone else had the account, leaving their session alive
    // defeats the point.
    await tx.delete(schema.userSessions).where(eq(schema.userSessions.userId, reset.userId))
  })

  if (user) {
    await recordAdminAction({
      organizationId: user.organizationId,
      type: AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
      actorEmail: user.email,
      targetEmail: user.email,
      ip: input.ip,
    })
  }

  return { ok: true }
}

/** Changing your own password, from inside a session. */
export async function changeOwnPassword(input: {
  session: StaffSession
  currentPassword: string
  newPassword: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validatePassword(input.newPassword)
  if (invalid) return { ok: false, message: invalid }

  const db = getDb()
  const [user] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, input.session.userId))
    .limit(1)

  if (!user?.passwordHash) return { ok: false, message: 'לא ניתן לשנות סיסמה.' }
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, message: 'הסיסמה הנוכחית אינה נכונה.' }
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.newPassword) })
    .where(eq(schema.users.id, input.session.userId))

  await destroySession()
  await db
    .delete(schema.userSessions)
    .where(eq(schema.userSessions.userId, input.session.userId))

  return { ok: true }
}

export async function listAdminAudit(session: StaffSession, limit = 100) {
  requireAdmin(session)
  return getDb()
    .select()
    .from(schema.adminAuditEvents)
    .where(eq(schema.adminAuditEvents.organizationId, session.organizationId))
    .orderBy(desc(schema.adminAuditEvents.createdAt))
    .limit(limit)
}

// ── email bodies ───────────────────────────────────────────────────────────

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function shell(body: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e4e5e7;border-radius:12px;padding:32px">
<tr><td style="text-align:right;color:#0f172a;font-size:16px;line-height:1.6">${body}</td></tr>
</table></td></tr></table></body></html>`
}

const button = (href: string, label: string) =>
  `<a href="${escape(href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold">${label}</a>`

function inviteHtml(name: string, url: string): string {
  return shell(
    `<p style="margin:0 0 8px">שלום ${escape(name)},</p>
<p style="margin:0 0 24px;font-size:18px;font-weight:bold">הוזמנת להשתמש ב-XTRA SIGN</p>
<p style="margin:0 0 24px;color:#64748b">להשלמת ההרשמה יש להגדיר סיסמה. הקישור בתוקף ל-72 שעות.</p>
${button(url, 'הגדרת סיסמה')}
<p style="margin:24px 0 0;font-size:12px;color:#64748b">אם לא ציפית להזמנה הזו, אפשר להתעלם מההודעה.</p>`,
  )
}

function resetHtml(name: string, url: string): string {
  return shell(
    `<p style="margin:0 0 8px">שלום ${escape(name)},</p>
<p style="margin:0 0 24px;font-size:18px;font-weight:bold">איפוס סיסמה</p>
<p style="margin:0 0 24px;color:#64748b">הקישור בתוקף לשעה אחת וניתן לשימוש פעם אחת.</p>
${button(url, 'איפוס סיסמה')}
<p style="margin:24px 0 0;font-size:12px;color:#64748b">אם לא ביקשת לאפס סיסמה, אפשר להתעלם מההודעה — הסיסמה הנוכחית תישאר בתוקף.</p>`,
  )
}
