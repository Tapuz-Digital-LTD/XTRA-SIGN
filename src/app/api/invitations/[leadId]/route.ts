import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { companyMatchesFor, sendHistory, updateFollowUp, type CallOutcome } from '@/server/invitations/invitations'

/** One person's details for the drawer: every message, and records they might already be. */
export async function GET(_request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    const session = await requireSession()
    const { leadId } = await context.params
    const [history, matches] = await Promise.all([sendHistory(session, leadId), companyMatchesFor(session, leadId)])
    return NextResponse.json({ history, matches })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Staff follow-up fields: who handles it, when to call back, how the call went, a private note. */
export async function PATCH(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { leadId } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const patch: Parameters<typeof updateFollowUp>[2] = {}
    if ('assigneeUserId' in body) patch.assigneeUserId = typeof body.assigneeUserId === 'string' && body.assigneeUserId ? body.assigneeUserId : null
    if ('followUpAt' in body) patch.followUpAt = typeof body.followUpAt === 'string' && body.followUpAt ? body.followUpAt : null
    if ('callOutcome' in body) patch.callOutcome = typeof body.callOutcome === 'string' && body.callOutcome ? (body.callOutcome as CallOutcome) : null
    if ('internalNote' in body) patch.internalNote = typeof body.internalNote === 'string' ? body.internalNote : null
    const result = await updateFollowUp(session, leadId, patch)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
