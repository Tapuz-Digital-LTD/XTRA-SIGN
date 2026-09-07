import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { listAudience, type AudienceView } from '@/server/invitations/invitations'

/** The rep's view of the campaign: everyone reached, with the newest word on each. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const p = new URL(request.url).searchParams
    const view = p.get('view')
    const result = await listAudience(session, id, {
      view: (['all', 'invited', 'waiting', 'registered', 'signed'] as AudienceView[]).includes(view as AudienceView) ? (view as AudienceView) : 'all',
      q: p.get('q') ?? undefined,
      rep: p.get('rep') ?? undefined,
      channel: p.get('channel') ?? undefined,
      followUpDue: p.get('due') === '1',
    })
    return NextResponse.json(result)
  } catch (error) {
    return templateFailure(error)
  }
}
