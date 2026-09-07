import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { updateCampaign } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { isCampaignGoal, isCampaignKind, isCampaignStatus, isEntryMethod, isRegistrationTarget } from '@/lib/campaigns'

/** The campaign's own settings: kind, dates, registrations after the end, link lifetime, owner, default agreement. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const day = (v: unknown): Date | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
      const d = new Date(`${v}T00:00:00+03:00`)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const result = await updateCampaign(session, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' || body.description === null ? (body.description as string | null) : undefined,
      campaignKind: isCampaignKind(body.campaignKind) ? body.campaignKind : undefined,
      goal: isCampaignGoal(body.goal) ? body.goal : undefined,
      registrationTarget: isRegistrationTarget(body.registrationTarget) ? body.registrationTarget : undefined,
      status: isCampaignStatus(body.status) ? body.status : undefined,
      endedMessage: typeof body.endedMessage === 'string' || body.endedMessage === null ? (body.endedMessage as string | null) : undefined,
      allowCompletionAfterEnd: typeof body.allowCompletionAfterEnd === 'boolean' ? body.allowCompletionAfterEnd : undefined,
      entryMethod: isEntryMethod(body.entryMethod) ? body.entryMethod : undefined,
      startsAt: day(body.startsAt),
      endsAt: day(body.endsAt),
      registrationsAfterEnd: typeof body.registrationsAfterEnd === 'boolean' ? body.registrationsAfterEnd : undefined,
      linkTtlDays: typeof body.linkTtlDays === 'number' ? body.linkTtlDays : undefined,
      ownerUserId: typeof body.ownerUserId === 'string' || body.ownerUserId === null ? (body.ownerUserId as string | null) : undefined,
      defaultTemplateId: typeof body.defaultTemplateId === 'string' || body.defaultTemplateId === null ? (body.defaultTemplateId as string | null) : undefined,
    })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
