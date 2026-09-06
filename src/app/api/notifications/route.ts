import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { clearReadNotifications, deleteNotification, listNotifications, markRead } from '@/server/notifications/notifications'

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ ok: true, ...(await listNotifications(session)) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Marks one notification read, or all of them when no id is given. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null
    await markRead(session, typeof body?.id === 'string' ? body.id : undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Deletes one notification (?id=), or every read one (?read=1). Not records; no ceremony. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      await deleteNotification(session, id)
      return NextResponse.json({ ok: true })
    }
    if (url.searchParams.get('read') === '1') {
      return NextResponse.json({ ok: true, cleared: await clearReadNotifications(session) })
    }
    return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
