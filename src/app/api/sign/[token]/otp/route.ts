import { NextResponse } from 'next/server'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { sendOtp, verifyOtp } from '@/server/signing/otp'
import { isSignable, resolveSigningToken } from '@/server/signing/session'

/** Send or verify the signer's one-time code. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }

  const { token } = await context.params
  const signing = await resolveSigningToken(token)

  // One answer for unknown, expired, revoked and closed.
  if (!signing || !isSignable(signing.status)) {
    return NextResponse.json({ error: { message: 'הקישור אינו זמין.' } }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; code?: string }
    | null

  if (body?.action === 'send') {
    const result = await sendOtp(signing)
    return result.ok
      ? NextResponse.json({
          ok: true,
          destination: result.maskedDestination,
          // Present only when nothing was actually sent.
          devCode: result.devCode,
        })
      : NextResponse.json({ error: { message: result.message } }, { status: 429 })
  }

  if (body?.action === 'verify') {
    const result = await verifyOtp(signing, String(body.code ?? ''), {
      ip: request.headers.get('x-forwarded-for'),
      userAgent: request.headers.get('user-agent'),
    })
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message } }, { status: 401 })
  }

  return NextResponse.json({ error: { message: 'בקשה לא תקינה.' } }, { status: 400 })
}
