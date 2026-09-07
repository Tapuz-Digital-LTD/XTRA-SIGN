import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { deleteSavedReport, getSavedReport, updateSavedReport } from '@/server/reports/engine/saved'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const report = await getSavedReport(session, id)
    if (!report) return NextResponse.json({ error: { message: 'הדוח לא נמצא.' } }, { status: 404 })
    return NextResponse.json({ report })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { name?: unknown; definition?: unknown; shared?: unknown } | null
    const result = await updateSavedReport(session, id, { name: body?.name, definition: body?.definition, shared: body?.shared })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ report: result.report })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const result = await deleteSavedReport(session, id)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
