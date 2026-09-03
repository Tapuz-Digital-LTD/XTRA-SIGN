import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { saveNotificationPrefs } from '@/server/notifications/notifications'

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    if (!session.isAdmin) throw new ForbiddenError()

    const body = (await request.json().catch(() => null)) as
      | { emails?: unknown; events?: unknown }
      | null

    await saveNotificationPrefs(session, {
      emails: Array.isArray(body?.emails) ? body.emails.filter((e): e is string => typeof e === 'string') : [],
      events:
        body?.events && typeof body.events === 'object'
          ? Object.fromEntries(
              Object.entries(body.events as Record<string, unknown>)
                .filter(([key]) => /^[a-z_]{1,40}$/.test(key))
                .map(([key, value]) => [key, Boolean(value)]),
            )
          : {},
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
