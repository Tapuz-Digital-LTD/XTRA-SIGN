import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { resendAgreement } from '@/server/documents/send-agreement'
import type { Channel } from '@/server/documents/send-validation'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'

/** A staff-initiated reminder: resend the signing link on the chosen channels. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    // Reminders send real messages to real people; cap how fast they can go out.
    const gate = await consume('signingLink', `${session.userId}:${id}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נשלחו יותר מדי תזכורות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { channels?: unknown } | null
    const channels = Array.isArray(body?.channels)
      ? (body!.channels.filter((c) => c === 'sms' || c === 'email') as Channel[])
      : []
    if (channels.length === 0) {
      return NextResponse.json({ error: { message: 'בחרו ערוץ לשליחה.' } }, { status: 400 })
    }

    const result = await resendAgreement({ session, agreementId: id, channels })
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message ?? 'השליחה נכשלה.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }
}
