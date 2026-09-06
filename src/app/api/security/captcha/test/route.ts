import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { testCaptchaSettings, type CaptchaSaveInput } from '@/server/security/captcha'

/** "בדיקת חיבור": a candidate configuration against Google, before it is saved. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as CaptchaSaveInput | null
    const result = await testCaptchaSettings(session, body ?? {})
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    if ((error as { status?: number } | null)?.status === 403) return NextResponse.json({ ok: false, message: 'רק מנהל מערכת יכול לבדוק הגדרות אבטחה.' }, { status: 403 })
    return templateFailure(error)
  }
}
