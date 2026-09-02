import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import type { ToolRisk } from './registry'

/**
 * Approving an action the assistant wants to take.
 *
 * A confirmation is never "the user typed yes". It names one action row, one
 * exact set of arguments, and an expiry — so an approval given for "send to
 * these 62 companies" cannot be replayed against a different 62, and an
 * approval left open overnight stops working.
 */

/** Long enough to read a list of eighty companies; short enough to be a decision. */
const APPROVAL_TTL_MS = 10 * 60 * 1000

/** How many times a person has to say yes before something irreversible happens. */
export const APPROVALS_REQUIRED: Record<ToolRisk, number> = {
  safe: 0,
  confirm: 1,
  critical: 2,
}

/** The arguments, canonically ordered, so the same call always hashes the same. */
export function hashPayload(toolName: string, input: unknown): string {
  return createHash('sha256').update(`${toolName}:${stableStringify(input)}`).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export async function recordAction(input: {
  session: StaffSession
  conversationId: string
  toolName: string
  risk: ToolRisk
  args: unknown
  inputSummary: string
}): Promise<{ actionId: string; approvalsRequired: number }> {
  const approvalsRequired = APPROVALS_REQUIRED[input.risk]
  const id = randomUUID()

  await getDb()
    .insert(schema.aiActions)
    .values({
      id,
      conversationId: input.conversationId,
      organizationId: input.session.organizationId,
      userId: input.session.userId,
      toolName: input.toolName,
      inputSummary: input.inputSummary,
      status: approvalsRequired > 0 ? 'pending' : 'ok',
      approvalStatus: approvalsRequired > 0 ? 'awaiting' : 'not_required',
      payloadHash: hashPayload(input.toolName, input.args),
      payload: approvalsRequired > 0 ? (input.args as object) : null,
      approvalExpiresAt: approvalsRequired > 0 ? new Date(Date.now() + APPROVAL_TTL_MS) : null,
    })

  return { actionId: id, approvalsRequired }
}

export type ApprovalCheck =
  | { ok: true; toolName: string; args: unknown }
  | { ok: false; reason: string }

/**
 * Confirms that this approval is for this action, from this user, still valid.
 *
 * Every failure is a refusal to act, never a warning: an approval that cannot
 * be matched to what was shown is not an approval.
 */
export async function claimApproval(
  session: StaffSession,
  actionId: string,
  payloadHash: string,
): Promise<ApprovalCheck> {
  const db = getDb()
  const [action] = await db
    .select()
    .from(schema.aiActions)
    .where(
      and(
        eq(schema.aiActions.id, actionId),
        // Scoped to the person who was shown the card, not merely the tenant.
        eq(schema.aiActions.userId, session.userId),
        eq(schema.aiActions.organizationId, session.organizationId),
      ),
    )
    .limit(1)

  if (!action) return { ok: false, reason: 'הבקשה לא נמצאה.' }
  if (action.approvalStatus === 'approved') return { ok: false, reason: 'הפעולה כבר בוצעה.' }
  if (action.approvalStatus === 'declined') return { ok: false, reason: 'הפעולה בוטלה.' }
  if (action.payloadHash !== payloadHash) {
    return { ok: false, reason: 'פרטי הפעולה השתנו. יש לאשר מחדש.' }
  }
  if (!action.approvalExpiresAt || action.approvalExpiresAt.getTime() < Date.now()) {
    await db
      .update(schema.aiActions)
      .set({ approvalStatus: 'expired', status: 'rejected' })
      .where(eq(schema.aiActions.id, actionId))
    return { ok: false, reason: 'תוקף האישור פג. יש לבקש שוב.' }
  }

  await db
    .update(schema.aiActions)
    .set({ approvalStatus: 'approved' })
    .where(eq(schema.aiActions.id, actionId))

  return { ok: true, toolName: action.toolName, args: action.payload }
}

export async function declineAction(session: StaffSession, actionId: string): Promise<void> {
  await getDb()
    .update(schema.aiActions)
    .set({ approvalStatus: 'declined', status: 'rejected' })
    .where(
      and(
        eq(schema.aiActions.id, actionId),
        eq(schema.aiActions.userId, session.userId),
        eq(schema.aiActions.organizationId, session.organizationId),
      ),
    )
}

export async function completeAction(input: {
  actionId: string
  status: 'ok' | 'failed'
  resultSummary: string
  target?: { type: string; id: string }
}): Promise<void> {
  await getDb()
    .update(schema.aiActions)
    .set({
      status: input.status,
      resultSummary: input.resultSummary.slice(0, 2000),
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
    })
    .where(eq(schema.aiActions.id, input.actionId))
}
