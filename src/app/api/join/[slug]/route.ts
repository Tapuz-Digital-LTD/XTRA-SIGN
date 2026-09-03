import { NextResponse } from 'next/server'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'
import { submitLead } from '@/server/projects/landing'

/**
 * The submission endpoint behind our own hosted joining form (and its embed).
 *
 * Unauthenticated by design — the whole point is that a supplier who has
 * nothing but the link can fill it in. Defended accordingly: per-IP rate
 * limit, a honeypot field no person ever sees, a payload cap, and the shared
 * schema validation inside submitLead.
 */
const MAX_BODY_BYTES = 50_000

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params
    const ip = clientIp(request)

    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: { message: 'הטופס גדול מדי.' } }, { status: 413 })
    }

    const gate = await consume('leadSubmit', `${ip ?? 'unknown'}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'התקבלו יותר מדי פניות. נסו שוב בעוד מספר דקות.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | {
          values?: Record<string, unknown>
          website?: unknown
          embed?: unknown
          referrer?: unknown
          source?: unknown
          idempotencyKey?: unknown
          meta?: unknown
        }
      | null

    // The honeypot: a hidden "website" input. People leave it empty; bots
    // helpfully fill it. A filled one gets a polite yes and no lead.
    if (typeof body?.website === 'string' && body.website.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    const result = await submitLead({
      slug,
      values: body?.values ?? {},
      ip,
      // A first-party page may declare which door it is; anything unknown
      // falls back to the hosted/embed pair.
      source:
        body?.source === 'tourism_landing' ? 'tourism_landing' : body?.embed === true ? 'embed' : 'landing',
      referrer: typeof body?.referrer === 'string' ? body.referrer : null,
      idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null,
      meta: body?.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null,
    })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message, fields: result.fields } }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error('lead submit failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { message: 'השליחה נכשלה. נסו שוב בעוד רגע.' } },
      { status: 500 },
    )
  }
}
