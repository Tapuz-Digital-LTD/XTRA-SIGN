import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { clientIp } from '@/server/log'
import { getCaptchaAdminView, saveCaptchaSettings, type CaptchaSaveInput } from '@/server/security/captcha'

/** The CAPTCHA settings, as an admin sees them (the credential is a hint) and changes them. */
export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json(await getCaptchaAdminView(session))
  } catch (error) {
    return failure(error)
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as CaptchaSaveInput | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const result = await saveCaptchaSettings(session, body, clientIp(request))
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json(result.view)
  } catch (error) {
    return failure(error)
  }
}

function failure(error: unknown) {
  if ((error as { status?: number } | null)?.status === 403) return NextResponse.json({ error: { message: 'רק מנהל מערכת יכול לשנות הגדרות אבטחה.' } }, { status: 403 })
  return templateFailure(error)
}
