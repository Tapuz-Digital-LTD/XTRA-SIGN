import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { createGroup, listGroups } from '@/server/groups/groups'
import { isCampaignKind } from '@/lib/campaigns'
import { saveLandingSettings } from '@/server/projects/landing'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    // A suppliers screen asks for supplier groups; anything else gets them all.
    const kind = new URL(request.url).searchParams.get('kind')
    const scoped = kind === 'supplier' || kind === 'customer' ? kind : undefined
    return NextResponse.json({ ok: true, groups: await listGroups(session, scoped) })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as
      | {
          name?: unknown
          description?: unknown
          kind?: unknown
          companyIds?: unknown
          campaignKind?: unknown
          startsAt?: unknown
          endsAt?: unknown
          ownerUserId?: unknown
          defaultTemplateId?: unknown
          joinMethod?: unknown
        }
      | null

    const day = (v: unknown): Date | null | undefined => {
      if (v === undefined) return undefined
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
      const d = new Date(`${v}T00:00:00+03:00`)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const result = await createGroup({
      session,
      name: String(body?.name ?? ''),
      description: typeof body?.description === 'string' ? body.description : null,
      kind: body?.kind === 'supplier' || body?.kind === 'customer' ? body.kind : null,
      companyIds: Array.isArray(body?.companyIds)
        ? (body.companyIds.filter((c) => typeof c === 'string') as string[])
        : undefined,
      campaignKind: isCampaignKind(body?.campaignKind) ? body.campaignKind : 'signature',
      startsAt: day(body?.startsAt),
      endsAt: day(body?.endsAt),
      ownerUserId: typeof body?.ownerUserId === 'string' ? body.ownerUserId : undefined,
      defaultTemplateId: typeof body?.defaultTemplateId === 'string' ? body.defaultTemplateId : undefined,
    })
    // A public campaign that joins through our form gets the form switched on now.
    if (result.ok && ['form', 'embed', 'api'].includes(String(body?.joinMethod))) {
      await saveLandingSettings(session, result.id, { enabled: true, config: {} })
    }
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
