import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { planReminders, runReminders } from '@/server/invitations/reminders'

/** "שלח תזכורת לנבחרים": the exact count first (dryRun), the sends only after a person confirms. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { ids?: unknown; dryRun?: unknown } | null
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
    if (ids.length === 0) return NextResponse.json({ error: { message: 'לא נבחר אף אחד.' } }, { status: 400 })
    if (body?.dryRun === true) return NextResponse.json(await planReminders(session, id, ids))
    const gate = await consume('signingLink', `${session.userId}:bulk`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי הודעות. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    return NextResponse.json(await runReminders(session, id, ids))
  } catch (error) {
    return templateFailure(error)
  }
}
