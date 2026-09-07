import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { isTaskStatus, updateTask } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** The same status for many tasks at once — "סמן כהוקם" over a selection. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    await authorizeGroup(session, id)
    const body = (await request.json().catch(() => null)) as { taskIds?: unknown; status?: unknown } | null
    const taskIds = Array.isArray(body?.taskIds) ? body!.taskIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : []
    const status = body?.status
    if (taskIds.length === 0 || !isTaskStatus(status)) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    let updated = 0
    for (const taskId of taskIds) if (await updateTask(session, taskId, { status })) updated++
    return NextResponse.json({ updated })
  } catch (error) {
    return templateFailure(error)
  }
}
