import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { replaceTemplate } from '@/server/templates/replace'

/** The new edition (`newTemplateId`) takes this template's place everywhere it was chosen. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { newTemplateId?: unknown } | null
    if (typeof body?.newTemplateId !== 'string') return NextResponse.json({ error: { message: 'חסרה התבנית החדשה.' } }, { status: 400 })
    const result = await replaceTemplate(session, id, body.newTemplateId)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, rebound: result.rebound })
  } catch (error) {
    return templateFailure(error)
  }
}
