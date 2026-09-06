import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { isRegistrationAction, planRegistrationActions, runRegistrationActions } from '@/server/reports/registration-actions'

/**
 * Acting from the report: a reminder, a resend, a copy — for one row or
 * many. `dryRun` answers "who is eligible" so the screen can say
 * "התזכורת תישלח ל-12 נמענים. 3 שכבר חתמו לא יקבלו הודעה." before anything
 * goes out; the real run sends only to those.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { ids?: unknown; action?: unknown; channels?: unknown; dryRun?: unknown } | null
    const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : []
    if (ids.length === 0 || !isRegistrationAction(body?.action)) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const channels = Array.isArray(body?.channels) ? (body!.channels.filter((c) => c === 'sms' || c === 'email') as ('sms' | 'email')[]) : []

    if (body?.dryRun === true) return NextResponse.json(await planRegistrationActions(session, id, ids, body.action))

    const gate = await consume('signingLink', `${session.userId}:bulk`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי הודעות. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    return NextResponse.json(await runRegistrationActions(session, id, ids, body.action, channels))
  } catch (error) {
    return templateFailure(error)
  }
}
