import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { backfillTasks } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/**
 * Tasks for the people who signed before tasks were switched on. Admin only;
 * `{ apply: false }` answers "how many would be created" so the screen can
 * ask before anything is written.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    if (!session.isAdmin) return NextResponse.json({ error: { message: 'אין הרשאה לפעולה זו.' } }, { status: 403 })
    const { id } = await context.params
    const group = await authorizeGroup(session, id)
    const body = (await request.json().catch(() => null)) as { apply?: unknown } | null
    return NextResponse.json(await backfillTasks(group.id, { apply: body?.apply === true }))
  } catch (error) {
    return templateFailure(error)
  }
}
