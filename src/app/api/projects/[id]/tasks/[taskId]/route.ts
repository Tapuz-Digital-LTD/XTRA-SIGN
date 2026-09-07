import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { isTaskStatus, updateTask, type TaskPatch } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** One task's status, person, date, note or link. Only the fields sent change. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id, taskId } = await context.params
    await authorizeGroup(session, id)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const patch: TaskPatch = {}
    if (body.status !== undefined) {
      if (!isTaskStatus(body.status)) return NextResponse.json({ error: { message: 'סטטוס לא מוכר.' } }, { status: 400 })
      patch.status = body.status
    }
    if (body.assigneeUserId !== undefined) patch.assigneeUserId = typeof body.assigneeUserId === 'string' ? body.assigneeUserId : null
    if (body.dueAt !== undefined) {
      const raw = typeof body.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueAt) ? new Date(`${body.dueAt}T00:00:00+03:00`) : null
      patch.dueAt = raw && !Number.isNaN(raw.getTime()) ? raw : null
    }
    if (body.note !== undefined) patch.note = typeof body.note === 'string' ? body.note : null
    if (body.link !== undefined) patch.link = typeof body.link === 'string' ? body.link : null

    const task = await updateTask(session, taskId, patch)
    if (!task) return NextResponse.json({ error: { message: 'המשימה לא נמצאה.' } }, { status: 404 })
    return NextResponse.json({ task })
  } catch (error) {
    return templateFailure(error)
  }
}
