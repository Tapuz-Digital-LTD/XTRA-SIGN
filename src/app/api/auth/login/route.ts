import { NextResponse } from 'next/server'
import { requestLoginCode, verifyLoginCode } from '@/server/auth/login'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { clientIp } from '@/server/log'

/**
 * Login in two steps: ask for a code, then present it.
 *
 * Both steps answer 400 with a Hebrew sentence and never say whether the number
 * belongs to anyone — the reasoning lives in `server/auth/login.ts`, which is
 * where the opaque answers are constructed.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)

    const body = (await request.json().catch(() => null)) as Record<string, string> | null
    if (!body) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const ip = clientIp(request)
    const phone = String(body.phone ?? '')

    if (body.step === 'request') {
      const result = await requestLoginCode(phone, { ip })
      return result.ok
        ? NextResponse.json({
            ok: true,
            message: result.message,
            maskedPhone: result.maskedDestination,
            ...(result.devCode ? { devCode: result.devCode } : {}),
          })
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    if (body.step === 'verify') {
      const result = await verifyLoginCode(phone, String(body.code ?? ''), { ip })
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ error: { message: 'בקשה לא תקינה.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }
}
