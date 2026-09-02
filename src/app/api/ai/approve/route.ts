import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { claimApproval, completeAction, declineAction } from '@/server/ai/approvals'
import { getTool, type ScreenContext } from '@/server/ai/registry'
import '@/server/ai/tools'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/**
 * Running an action the user approved.
 *
 * The action is looked up by id and matched against the hash of exactly the
 * arguments that were displayed. A "yes" therefore authorises one specific
 * thing — not the tool in general, and not whatever the model asks for next.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const body = (await request.json().catch(() => null)) as {
      actionId?: unknown
      payloadHash?: unknown
      decline?: unknown
      screen?: unknown
    } | null

    const actionId = typeof body?.actionId === 'string' ? body.actionId : ''
    const payloadHash = typeof body?.payloadHash === 'string' ? body.payloadHash : ''
    if (!actionId || !payloadHash) {
      return NextResponse.json({ error: { message: 'בקשה לא תקינה.' } }, { status: 400 })
    }

    if (body?.decline === true) {
      await declineAction(session, actionId)
      return NextResponse.json({ ok: true, declined: true })
    }

    const claim = await claimApproval(session, actionId, payloadHash)
    if (!claim.ok) {
      return NextResponse.json({ error: { message: claim.reason } }, { status: 409 })
    }

    const tool = getTool(claim.toolName)
    if (!tool) {
      return NextResponse.json({ error: { message: 'הפעולה אינה זמינה.' } }, { status: 400 })
    }

    try {
      const result = await tool.run(claim.args as never, {
        session,
        screen: (body?.screen ?? {}) as ScreenContext,
        ip: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      })
      await completeAction({
        actionId,
        status: 'ok',
        resultSummary: result.summary,
        target: result.target,
      })
      return NextResponse.json({ ok: true, summary: result.summary, data: result.data ?? null })
    } catch {
      await completeAction({ actionId, status: 'failed', resultSummary: 'failed' })
      // The technical detail stays in the logs; the user gets something usable.
      return NextResponse.json(
        { error: { message: 'הפעולה לא הושלמה. אפשר לנסות שוב.' } },
        { status: 500 },
      )
    }
  } catch (error) {
    return templateFailure(error)
  }
}
