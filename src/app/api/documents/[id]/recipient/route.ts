import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { saveRecipient } from '@/server/documents/save-fields'

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = (await request.json().catch(() => null)) as Record<string, string> | null
    if (!body) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await saveRecipient({
      session,
      agreementId: id,
      name: String(body.name ?? ''),
      company: body.company ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    throw error
  }
}
