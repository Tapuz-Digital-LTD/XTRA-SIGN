import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { getShareSettings, saveShareSettings } from '@/server/projects/share'

/** The campaign's share card: title, line, picture. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const settings = await getShareSettings(session, id)
    if (!settings) return NextResponse.json({ error: { message: 'הקמפיין לא נמצא.' } }, { status: 404 })
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { title?: unknown; description?: unknown } | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const result = await saveShareSettings(session, id, body)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, settings: result.settings })
  } catch (error) {
    return templateFailure(error)
  }
}
