import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { deleteTemplate, renameTemplate } from '@/server/templates/templates'
import { templateFailure } from '@/server/http/template-errors'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null
    if (!body || typeof body.name !== 'string') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await renameTemplate({ session, templateId: id, name: body.name })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const result = await deleteTemplate({ session, templateId: id })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
