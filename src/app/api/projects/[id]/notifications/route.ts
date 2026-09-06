import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { getProjectNotificationSettings, saveProjectNotificationSettings, type ProjectNotificationSettings } from '@/server/projects/notification-settings'

/** A project's notification settings: addresses, events, the signer's confirmation. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json(await getProjectNotificationSettings(session, id))
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Partial<ProjectNotificationSettings> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const result = await saveProjectNotificationSettings(session, id, body)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json(result.settings)
  } catch (error) {
    return templateFailure(error)
  }
}
