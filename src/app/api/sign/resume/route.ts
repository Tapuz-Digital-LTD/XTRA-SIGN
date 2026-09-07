import { NextResponse } from 'next/server'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { continueSigning } from '@/server/signing/continue'

/**
 * "ממשיכים לחתימה": a fresh link for the same agreement behind a link that
 * ran out. Rate-limited like a code send; never creates anything.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const gate = await consume('otpSend', clientIp(request) ?? 'unknown')
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) return NextResponse.json({ error: { message: 'חסר מזהה.' } }, { status: 400 })
    const result = await continueSigning(token)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: result.closed ? 410 : 404 })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'הפעולה נכשלה.' } }, { status: 400 })
  }
}
