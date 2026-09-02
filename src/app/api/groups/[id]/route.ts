import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { addCompanies, deleteGroup, removeCompanies, renameGroup } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** Adds or removes members, or renames the group. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; companyIds?: unknown; name?: unknown; description?: unknown }
      | null

    const companyIds = Array.isArray(body?.companyIds)
      ? (body.companyIds.filter((c) => typeof c === 'string') as string[])
      : []

    if (body?.action === 'add') {
      return NextResponse.json(await addCompanies({ session, groupId: id, companyIds }))
    }
    if (body?.action === 'remove') {
      return NextResponse.json(await removeCompanies({ session, groupId: id, companyIds }))
    }
    if (body?.action === 'rename') {
      const result = await renameGroup({
        session,
        groupId: id,
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
      })
      return result.ok
        ? NextResponse.json(result)
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ error: { message: 'פעולה לא מוכרת.' } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    // Removes the grouping only — companies and their agreements stay.
    return NextResponse.json(await deleteGroup(session, id))
  } catch (error) {
    return templateFailure(error)
  }
}
