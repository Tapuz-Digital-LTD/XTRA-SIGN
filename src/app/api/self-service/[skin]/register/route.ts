import { after, NextResponse } from 'next/server'
import { generateToken } from '@/server/auth/tokens'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'
import { startSelfServiceSigning } from '@/server/self-service/onboarding'

/**
 * The public door of a self-service project: details in, a signing token and
 * an OTP out (ADR 0001).
 *
 * Unauthenticated by design and defended accordingly: a payload cap, a per-IP
 * rate limit, a honeypot no person sees, an idempotency key the page mints per
 * attempt, and the same validation whatever the caller. The response carries
 * the signing token and nothing else about what was created — no ids, no
 * links — because the token is all the browser needs and all it should hold.
 */
const MAX_BODY_BYTES = 50_000

export async function POST(request: Request, context: { params: Promise<{ skin: string }> }) {
  try {
    const { skin } = await context.params
    const ip = clientIp(request)

    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: { message: 'הטופס גדול מדי.' } }, { status: 413 })
    }

    const gate = await consume('leadSubmit', `${ip ?? 'unknown'}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'התקבלו יותר מדי פניות מהכתובת הזו. נסו שוב בעוד מספר דקות.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | {
          values?: Record<string, unknown>
          website?: unknown
          idempotencyKey?: unknown
          referrer?: unknown
          meta?: unknown
        }
      | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    // The honeypot: a hidden "website" input. People leave it empty; bots
    // helpfully fill it. A filled one gets a convincing answer and nothing
    // is created — the token it carries opens nothing.
    if (typeof body.website === 'string' && body.website.trim()) {
      return NextResponse.json({ ok: true, kind: 'ready', token: generateToken(), maskedPhone: '05X-XXX-XXXX', otp: { sent: true } })
    }

    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(body.idempotencyKey)) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await startSelfServiceSigning({
      skin,
      values: body.values && typeof body.values === 'object' ? body.values : {},
      idempotencyKey: body.idempotencyKey,
      ip,
      referrer: typeof body.referrer === 'string' ? body.referrer : null,
      meta: body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message, fields: result.fields } }, { status: 400 })
    }

    // Messages after the answer: the person is already here.
    after(() => result.afterResponse())

    if (result.kind === 'already_signed') {
      return NextResponse.json({ ok: true, kind: 'already_signed', maskedContact: result.maskedContact })
    }
    return NextResponse.json({
      ok: true,
      kind: 'ready',
      token: result.token,
      maskedPhone: result.maskedPhone,
      otp: result.otp,
    })
  } catch (error) {
    log.error('self-service register failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: { message: 'ההרשמה נכשלה. נסו שוב בעוד רגע.' } }, { status: 500 })
  }
}
