import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { templateLayout } from '@/server/templates/templates'

/** The template's pages (measured) and placed fields, for a preview. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const layout = await templateLayout(session, id)
    if (!layout.ok) return NextResponse.json({ error: { message: layout.message } }, { status: 400 })
    return NextResponse.json({ ok: true, name: layout.name, pages: layout.pages, fields: layout.fields })
  } catch (error) {
    return templateFailure(error)
  }
}
