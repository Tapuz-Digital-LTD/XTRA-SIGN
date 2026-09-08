import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { bulkUpdateTasks, isTaskStatus, type TaskPatch } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/**
 * One change for many tasks at once — "סמן כהוקם", "שיוך אחראי", "קבע תאריך
 * יעד" over a selection. Body: `{ taskIds, status?, assigneeUserId?, dueAt? }`
 * with at least one field besides the ids; `dueAt` is a day (`2026-10-01`)
 * or an ISO string, null to clear. Answers `{ updated, failed }`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    await authorizeGroup(session, id)
    const body = (await request.json().catch(() => null)) as { taskIds?: unknown; status?: unknown; assigneeUserId?: unknown; dueAt?: unknown } | null
    const taskIds = Array.isArray(body?.taskIds) ? body!.taskIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : []
    const bad = (message: string) => NextResponse.json({ error: { message } }, { status: 400 })
    if (taskIds.length === 0) return bad('לא נבחרו משימות.')

    const patch: TaskPatch = {}
    if (body?.status !== undefined) {
      if (!isTaskStatus(body.status)) return bad('סטטוס לא מוכר.')
      patch.status = body.status
    }
    if (body?.assigneeUserId !== undefined) patch.assigneeUserId = typeof body.assigneeUserId === 'string' ? body.assigneeUserId : null
    if (body?.dueAt !== undefined) {
      if (body.dueAt === null) patch.dueAt = null
      else {
        // A bare day is Israel's midnight, as the single-task route reads it.
        const date = typeof body.dueAt === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(body.dueAt) ? `${body.dueAt}T00:00:00+03:00` : body.dueAt) : null
        if (!date || Number.isNaN(date.getTime())) return bad('תאריך לא תקין.')
        patch.dueAt = date
      }
    }
    if (Object.keys(patch).length === 0) return bad('לא נבחר מה לשנות.')

    return NextResponse.json(await bulkUpdateTasks(session, taskIds, patch))
  } catch (error) {
    return templateFailure(error)
  }
}
