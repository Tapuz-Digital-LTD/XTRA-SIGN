import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { followUpConfigFor, isTaskStatus, listTasks, taskCounts } from '@/server/follow-up/tasks'
import { authorizeGroup } from '@/server/groups/groups'
import { templateFailure } from '@/server/http/template-errors'

/** A campaign's follow-up tasks (`?status=`), their counts, and what the campaign creates. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const group = await authorizeGroup(session, id)
    const status = new URL(request.url).searchParams.get('status')
    const [tasks, counts, config] = await Promise.all([
      listTasks(session, group.id, { status: isTaskStatus(status) ? status : undefined }),
      taskCounts(session, group.id),
      followUpConfigFor(group.id),
    ])
    return NextResponse.json({ tasks, counts, config })
  } catch (error) {
    return templateFailure(error)
  }
}
