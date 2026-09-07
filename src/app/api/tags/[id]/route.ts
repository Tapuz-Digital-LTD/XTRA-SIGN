import { NextResponse } from 'next/server'
import { NotAdminError, requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { deleteTag, renameTag } from '@/server/tags/tags'

/** Rename a tag. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body.name !== 'string') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const result = await renameTag(session, id, body.name)
    return result.ok ? NextResponse.json({ ok: true, tag: result.tag }) : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Remove a tag everywhere. Admin only. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const result = await deleteTag(session, id)
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { message: result.message } }, { status: 404 })
  } catch (error) {
    if (error instanceof NotAdminError) return NextResponse.json({ error: { message: 'רק מנהל יכול למחוק תג.' } }, { status: 403 })
    return templateFailure(error)
  }
}
