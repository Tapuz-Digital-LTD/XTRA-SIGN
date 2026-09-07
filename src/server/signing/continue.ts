import { eq } from 'drizzle-orm'
import { maskPhone } from '@/lib/phone'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { mintAdditionalSigningLink, ttlDaysFor } from '@/server/documents/send-agreement'
import { loadSelfServiceProject } from '@/server/projects/self-service'
import { selfServiceOriginOf } from '@/server/self-service/agreement-skin'
import { resumeSigning } from '@/server/self-service/resume'
import { hasVerifiedSessionFor, resolveTokenForRenewal, type SigningContext } from '@/server/signing/session'

/**
 * A signing link is the address of a process, not a key with a lifetime.
 *
 * The token in the message identifies the agreement for as long as the
 * agreement exists (its hash is never deleted); what runs out is only the
 * permission behind it. When that happens the page does the technical work:
 *
 *   - the signer's browser already proved the phone (a verified session)
 *     → a fresh token is minted and the page continues, no screen shown;
 *   - otherwise → one screen, one button: "קבלו קוד לטלפון", which mints the
 *     fresh token and sends the signer to the code entry of the same document.
 *
 * Nothing here creates a company, a registration or a second agreement, and
 * a revoked link stays revoked — that is a staff decision, not a lifetime.
 */

export type ContinueResult =
  | { ok: true; kind: 'ready' | 'already_signed'; token: string; path: string; maskedPhone: string | null }
  | { ok: false; message: string; closed?: boolean }

const OPEN: SigningContext['status'][] = ['sent', 'viewed', 'expired']

/** Where a token's page lives: the campaign's branded pages, or the plain signer page. */
export async function pathForToken(agreementId: string, token: string, signed: boolean): Promise<string> {
  const origin = await selfServiceOriginOf(agreementId)
  if (origin) return signed ? `/${origin.slug}/thanks/${token}` : `/${origin.slug}/sign/${token}`
  return `/sign/${token}`
}

async function mint(agreementId: string, recipientId: string, by: string): Promise<string> {
  const db = getDb()
  const ttlDays = await ttlDaysFor(agreementId)
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
  const minted = await mintAdditionalSigningLink(recipientId, expiresAt)
  const [agreement] = await db.select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1)
  if (agreement?.status === 'expired') await db.update(schema.agreements).set({ status: 'sent', expiresAt }).where(eq(schema.agreements.id, agreementId))
  if (agreement?.status !== 'signed') {
    await db.insert(schema.auditEvents).values({ agreementId, recipientId, type: AUDIT_EVENTS.LINK_RENEWED, actor: 'signer', metadata: { by, ttlDays } })
  }
  return minted.token
}

async function campaignAllowsCompletion(agreementId: string): Promise<boolean | null> {
  const origin = await selfServiceOriginOf(agreementId)
  if (!origin) return null
  const project = await loadSelfServiceProject(origin.projectId)
  if (!project) return null
  return project.registrationsOpen || project.completionAllowed
}

/**
 * The quiet path: an expired token whose signer this browser has already
 * verified gets a fresh one with no screen in between. Null when there is
 * nothing to do quietly — the caller then shows the one-button screen.
 */
export async function renewQuietly(token: string): Promise<{ token: string; path: string } | null> {
  const found = await resolveTokenForRenewal(token)
  if (!found || !found.expired) return null
  if (!(await hasVerifiedSessionFor(found.recipientId))) return null
  if (found.status === 'signed') {
    const fresh = await mint(found.agreementId, found.recipientId, 'session')
    return { token: fresh, path: await pathForToken(found.agreementId, fresh, true) }
  }
  if (!OPEN.includes(found.status)) return null
  if ((await campaignAllowsCompletion(found.agreementId)) === false) return null
  const fresh = await mint(found.agreementId, found.recipientId, 'session')
  return { token: fresh, path: await pathForToken(found.agreementId, fresh, false) }
}

/** What an expired link is about, for the one-button screen. */
export async function describeExpired(token: string): Promise<{ maskedPhone: string | null; signed: boolean; closed: boolean; title: string } | null> {
  const found = await resolveTokenForRenewal(token)
  if (!found) return null
  const db = getDb()
  const [recipient] = await db.select({ phone: schema.recipients.phone }).from(schema.recipients).where(eq(schema.recipients.id, found.recipientId)).limit(1)
  const [agreement] = await db.select({ title: schema.agreements.title }).from(schema.agreements).where(eq(schema.agreements.id, found.agreementId)).limit(1)
  const closed = found.status === 'signed' ? false : !OPEN.includes(found.status) || (await campaignAllowsCompletion(found.agreementId)) === false
  return { maskedPhone: maskPhone(recipient?.phone ?? null) ?? null, signed: found.status === 'signed', closed, title: agreement?.title ?? '' }
}

/**
 * The one-button path: mints the fresh token and, for a campaign agreement,
 * defers to the campaign's own resume (which also sends the code and honours
 * the campaign's closed state). The plain signer page sends the code itself
 * when it opens on the code step, so nothing is sent twice.
 */
export async function continueSigning(token: string): Promise<ContinueResult> {
  const found = await resolveTokenForRenewal(token)
  if (!found) return { ok: false, message: 'הקישור הזה כבר לא פעיל. אם קיבלתם הודעה חדשה יותר, פתחו את הקישור שבה.' }

  const origin = await selfServiceOriginOf(found.agreementId)
  if (origin) {
    const project = await loadSelfServiceProject(origin.projectId)
    if (project) {
      const result = await resumeSigning(project, { token })
      if (!result.ok) return result
      const path = result.kind === 'already_signed' ? `/${origin.slug}/thanks/${result.token}` : `/${origin.slug}/sign/${result.token}`
      return { ok: true, kind: result.kind, token: result.token, path, maskedPhone: result.kind === 'ready' ? result.maskedPhone : null }
    }
  }

  const db = getDb()
  const [recipient] = await db.select({ phone: schema.recipients.phone }).from(schema.recipients).where(eq(schema.recipients.id, found.recipientId)).limit(1)
  if (found.status === 'signed') {
    const fresh = await mint(found.agreementId, found.recipientId, 'continue')
    return { ok: true, kind: 'already_signed', token: fresh, path: `/sign/${fresh}`, maskedPhone: null }
  }
  if (!OPEN.includes(found.status)) return { ok: false, closed: true, message: 'המסמך הזה כבר אינו פתוח לחתימה.' }
  const fresh = await mint(found.agreementId, found.recipientId, 'continue')
  return { ok: true, kind: 'ready', token: fresh, path: `/sign/${fresh}?continue=1`, maskedPhone: maskPhone(recipient?.phone ?? null) ?? null }
}
