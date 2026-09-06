import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { saveTemplateFields, templateLayout } from '@/server/templates/templates'

/** A template's pages and fields (GET), and a new layout for it (PUT). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const layout = await templateLayout(session, id)
    if (!layout.ok) return NextResponse.json({ error: { message: layout.message } }, { status: 404 })
    return NextResponse.json({ name: layout.name, pages: layout.pages, fields: layout.fields })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { fields?: unknown } | null
    const result = await saveTemplateFields({ session, templateId: id, fields: body?.fields })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, count: result.count })
  } catch (error) {
    return templateFailure(error)
  }
}
