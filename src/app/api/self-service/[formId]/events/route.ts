import { NextResponse } from 'next/server'
import { isCampaignEventType, referrerHost, utmFrom, VISIT_ID_RE } from '@/lib/campaign-events'
import { recordCampaignEvent } from '@/server/analytics/campaign-events'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { findSelfServiceProjectByFormId } from '@/server/projects/self-service'
import { resolveSigningToken } from '@/server/signing/session'

/**
 * The campaign pages' analytics door: one small event per call.
 *
 * Unauthenticated, so it trusts nothing: the type must be one of ours, the
 * visit id must look like one we mint, the address and tags are capped, the
 * referrer is reduced to its host. A signing token, when given, ties the
 * event to its agreement server-side — the browser never names an agreement
 * id. The IP is used for the rate limit only and is not stored.
 */
export async function POST(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params
  const gate = await consume('campaignEvent', clientIp(request) ?? 'unknown')
  if (!gate.allowed) return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })

  const body = (await request.json().catch(() => null)) as
    | { type?: unknown; visitId?: unknown; path?: unknown; utm?: unknown; referrer?: unknown; token?: unknown }
    | null
  if (!body || !isCampaignEventType(body.type) || typeof body.visitId !== 'string' || !VISIT_ID_RE.test(body.visitId)) {
    return new NextResponse(null, { status: 204 })
  }

  const project = await findSelfServiceProjectByFormId(formId)
  if (!project) return new NextResponse(null, { status: 204 })

  let agreementId: string | null = null
  if (typeof body.token === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(body.token)) {
    const signing = await resolveSigningToken(body.token)
    agreementId = signing?.agreementId ?? null
  }

  const path = typeof body.path === 'string' ? body.path.slice(0, 200) : null
  const requestedSlug = path?.split('/')[1]?.slice(0, 80) ?? null

  await recordCampaignEvent({
    organizationId: project.organizationId,
    groupId: project.groupId,
    type: body.type,
    visitId: body.visitId,
    requestedSlug,
    canonicalSlug: project.publicSlug,
    path,
    utm: body.utm && typeof body.utm === 'object' ? utmFrom(body.utm as Record<string, string | undefined>) : null,
    referrer: referrerHost(typeof body.referrer === 'string' ? body.referrer : null),
    agreementId,
  })
  return new NextResponse(null, { status: 204 })
}
