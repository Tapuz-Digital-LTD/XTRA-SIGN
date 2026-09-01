import { and, eq, ne, or, desc } from 'drizzle-orm'
import { AUDIT_EVENTS } from './admin-audit'
import { normalizeIsraeliPhone, UNSUPPORTED_PHONE_MESSAGE } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { consume } from '@/server/http/rate-limit'
import { log } from '@/server/log'
import { InforuEmailProvider } from '@/server/notifications/inforu'
import { recordAdminAction } from './admin-audit'

/**
 * Staff accounts.
 *
 * There is no public signup and no password anywhere. An account exists only
 * because an admin created it, and the person proves who they are by receiving
 * an SMS on the number that admin recorded — so the phone number is the
 * credential, and creating the account is all the "invitation" there is.
 */

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

// ── listing ────────────────────────────────────────────────────────────────

export type UserRow = {
  id: string
  email: string
  name: string
  role: UserRole
  phone: string
  disabled: boolean
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
    phone: row.phone,
    disabled: Boolean(row.disabledAt),
    lastLoginAt: row.lastLoginAt,
  }))
}

// ── create ────────────────────────────────────────────────────────────────

export type CreateUserResult = { ok: true } | { ok: false; message: string }

/**
 * Creates a staff account. There is nothing for the new person to accept:
 * their phone number is their way in, so the account works the moment it
 * exists. They are told by email that it does.
 */
export async function createUser(input: {
  session: StaffSession
  email: string
  name: string
  phone: string
  role: UserRole
  ip?: string | null
}): Promise<CreateUserResult> {
  requireAdmin(input.session)

  const email = input.email.trim().toLowerCase()
  const name = input.name.trim().slice(0, 120)
  const phone = normalizeIsraeliPhone(input.phone)

  if (!name) return { ok: false, message: 'יש להזין שם.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'כתובת האימייל אינה תקינה.' }
  }
  // Without a usable number the account could never be logged into, so this is
  // refused at creation rather than discovered by the person at the login form.
  if (!phone) return { ok: false, message: UNSUPPORTED_PHONE_MESSAGE }

  const gate = await consume('userCreate', input.session.organizationId)
  if (!gate.allowed) return { ok: false, message: 'נוצרו יותר מדי משתמשים. נסו שוב מאוחר יותר.' }

  const db = getDb()

  // Both are login identities and both are unique across the system, so both
  // are checked before the insert to turn a constraint violation into a
  // sentence an admin can act on.
  const [clash] = await db
    .select({ email: schema.users.email, phone: schema.users.phone })
    .from(schema.users)
    .where(or(eq(schema.users.email, email), eq(schema.users.phone, phone)))
    .limit(1)

  if (clash) {
    return {
      ok: false,
      message:
        clash.email === email
          ? 'כתובת האימייל כבר רשומה במערכת.'
          : 'מספר הטלפון כבר רשום למשתמש אחר.',
    }
  }

  await db.insert(schema.users).values({
    organizationId: input.session.organizationId,
    email,
    name,
    phone,
    role: input.role,
    isAdmin: input.role === 'admin',
  })

  const base = (process.env.SIGN_PUBLIC_URL ?? '').replace(/\/+$/, '')
  const sent = await new InforuEmailProvider().send({
    to: email,
    subject: 'נפתח עבורך חשבון ב-XTRA SIGN',
    text: `שלום ${name}, נפתח עבורך חשבון ב-XTRA SIGN. לכניסה: ${base} — הזינו את מספר הטלפון שלכם ותקבלו קוד ב-SMS.`,
    html: welcomeHtml(name, base),
    recipientName: name,
  })

  await recordAdminAction({
    organizationId: input.session.organizationId,
    type: AUDIT_EVENTS.USER_CREATED,
    actorEmail: input.session.email,
    targetEmail: email,
    ip: input.ip,
    metadata: { role: input.role, delivered: sent.ok },
  })

  if (!sent.ok) {
    // The account works either way — the email is a courtesy, not the key — so
    // this reports what happened instead of failing the whole action.
    return { ok: false, message: 'המשתמש נוצר, אך שליחת ההודעה במייל נכשלה.' }
  }

  return { ok: true }
}

// ── edit ──────────────────────────────────────────────────────────────────

/**
 * Changes the details an admin recorded. Not the role, and not the disabled
 * flag — those have their own functions because each carries its own audit
 * event and its own "you cannot do this to yourself" rule.
 */
export async function updateUser(input: {
  session: StaffSession
  userId: string
  email: string
  name: string
  phone: string
  ip?: string | null
}): Promise<CreateUserResult> {
  requireAdmin(input.session)

  const email = input.email.trim().toLowerCase()
  const name = input.name.trim().slice(0, 120)
  const phone = normalizeIsraeliPhone(input.phone)

  if (!name) return { ok: false, message: 'יש להזין שם.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'כתובת האימייל אינה תקינה.' }
  }
  if (!phone) return { ok: false, message: UNSUPPORTED_PHONE_MESSAGE }

  const db = getDb()

  // Scoped to the admin's own organization, in the WHERE clause rather than
  // checked afterwards, so another tenant's user cannot be edited by id.
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

  const [clash] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(
      and(
        ne(schema.users.id, target.id),
        or(eq(schema.users.email, email), eq(schema.users.phone, phone)),
      ),
    )
    .limit(1)

  if (clash) {
    return {
      ok: false,
      message:
        clash.email === email
          ? 'כתובת האימייל כבר רשומה במערכת.'
          : 'מספר הטלפון כבר רשום למשתמש אחר.',
    }
  }

  await db
    .update(schema.users)
    .set({ email, name, phone })
    .where(eq(schema.users.id, target.id))

  await recordAdminAction({
    organizationId: input.session.organizationId,
    type: AUDIT_EVENTS.USER_UPDATED,
    actorEmail: input.session.email,
    targetEmail: email,
    ip: input.ip,
    // The phone is the login credential, so a change to it is the one worth
    // being able to point at later.
    metadata: { phoneChanged: true, previousEmail: target.email },
  })

  return { ok: true }
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

function welcomeHtml(name: string, url: string): string {
  return shell(
    `<p style="margin:0 0 8px">שלום ${escape(name)},</p>
<p style="margin:0 0 24px;font-size:18px;font-weight:bold">נפתח עבורך חשבון ב-XTRA SIGN</p>
<p style="margin:0 0 24px;color:#64748b">אין צורך בסיסמה. בכניסה מזינים את מספר הטלפון ומקבלים קוד חד-פעמי ב-SMS.</p>
${button(url, 'כניסה למערכת')}
<p style="margin:24px 0 0;font-size:12px;color:#64748b">אם לא ציפית להודעה הזו, אפשר להתעלם ממנה.</p>`,
  )
}
