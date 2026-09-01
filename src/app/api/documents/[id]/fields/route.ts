import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { saveFields } from '@/server/documents/save-fields'

/** Autosave target for the field editor. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await saveFields({
      session,
      agreementId: id,
      fields: (body as { fields?: unknown }).fields,
    })

    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ saved: result.count })
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
