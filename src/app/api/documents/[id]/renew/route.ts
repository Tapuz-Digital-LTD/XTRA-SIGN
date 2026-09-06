import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { renewSigningLink } from '@/server/documents/send-agreement'
import type { Channel } from '@/server/documents/send-validation'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/** "חדש קישור לחתימה": a fresh link with a fresh lifetime, recorded as such. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const gate = await consume('signingLink', `${session.userId}:${id}`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי הודעות. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { channels?: unknown } | null
    const channels = Array.isArray(body?.channels) ? (body!.channels.filter((c) => c === 'sms' || c === 'email') as Channel[]) : (['sms', 'email'] as Channel[])
    const result = await renewSigningLink({ session, agreementId: id, channels })
    return result.ok ? NextResponse.json({ ok: true, expiresAt: result.expiresAt }) : NextResponse.json({ error: { message: result.message ?? 'החידוש נכשל.' } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
