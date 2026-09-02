import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { deleteConversation, loadMessages, renameConversation } from '@/server/ai/conversations'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json({ ok: true, messages: await loadMessages(session, id) })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { title?: unknown } | null
    if (typeof body?.title !== 'string') {
      return NextResponse.json({ error: { message: 'חסר שם.' } }, { status: 400 })
    }
    await renameConversation(session, id, body.title)
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
    await deleteConversation(session, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
