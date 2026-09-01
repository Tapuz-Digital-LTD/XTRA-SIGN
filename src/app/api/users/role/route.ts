import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { clientIp } from '@/server/log'
import { NotAdminError, setUserRole } from '@/server/users/users'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as Record<string, string> | null
    if (!body) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await setUserRole({
      session,
      userId: String(body.userId ?? ""),
      role: body.role === "admin" ? "admin" : "user",
      ip: clientIp(request),
    })

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    // A non-admin gets the same answer as anyone else who is not allowed here.
    if (error instanceof NotAdminError) {
      return NextResponse.json({ error: { message: 'אין הרשאה לפעולה זו.' } }, { status: 403 })
    }
    throw error
  }
}
