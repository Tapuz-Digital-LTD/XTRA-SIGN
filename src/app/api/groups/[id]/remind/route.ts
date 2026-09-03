import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { bulkRemind } from '@/server/groups/bulk-send'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/** A reminder to the ticked suppliers — never to "everyone". */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    // Reminders send real messages to real people; cap how fast they can go out.
    const gate = await consume('signingLink', `${session.userId}:bulk-remind`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נשלחו יותר מדי תזכורות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { companyIds?: unknown } | null
    const companyIds = Array.isArray(body?.companyIds)
      ? body.companyIds.filter((c): c is string => typeof c === 'string')
      : []
    if (companyIds.length === 0) {
      return NextResponse.json({ error: { message: 'יש לסמן ספקים לפני שליחת תזכורת.' } }, { status: 400 })
    }

    return NextResponse.json(await bulkRemind({ session, groupId: id, companyIds }))
  } catch (error) {
    return templateFailure(error)
  }
}
