import { NextResponse } from 'next/server'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'
import { getPublicLanding, submitLead } from '@/server/projects/landing'

/**
 * The Public Submission API: an external site posts form values, a lead is
 * born — through the exact same pipeline as the hosted form.
 *
 * The slug in the URL is the form's publishable id. It is scoped to one
 * power only — creating a lead on this one form — so it may live in public
 * JavaScript. Nothing here reads, lists or updates anything.
 *
 * Cross-origin by nature, so CORS is part of the contract: a project may pin
 * the origins allowed to call it; with no list configured the form is as
 * public as its hosted page.
 */
const MAX_BODY_BYTES = 50_000

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const allow = allowed.length === 0 ? (origin ?? '*') : allowed.includes(origin ?? '') ? origin! : ''
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const landing = await getPublicLanding(slug).catch(() => null)
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), landing?.config.allowedOrigins ?? []),
  })
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const origin = request.headers.get('origin')
  try {
    const { slug } = await context.params
    const landing = await getPublicLanding(slug)
    const headers = corsHeaders(origin, landing?.config.allowedOrigins ?? [])

    if (!landing) {
      return NextResponse.json({ error: { message: 'הטופס אינו פעיל.', code: 'form_not_found' } }, { status: 404, headers })
    }

    // A browser call from an origin the project did not allow stops here.
    // Server-to-server calls carry no Origin and cannot be pinned this way.
    if (landing.config.allowedOrigins.length > 0 && origin && !landing.config.allowedOrigins.includes(origin)) {
      return NextResponse.json({ error: { message: 'Origin not allowed.', code: 'origin_not_allowed' } }, { status: 403, headers })
    }

    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: { message: 'Payload too large.', code: 'payload_too_large' } }, { status: 413, headers })
    }

    const ip = clientIp(request)
    const gate = await consume('leadSubmit', `${ip ?? 'unknown'}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'Too many requests.', code: 'rate_limited' } },
        { status: 429, headers: { ...headers, 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { values?: Record<string, unknown>; idempotencyKey?: unknown }
      | null
    if (!body || typeof body.values !== 'object' || body.values === null) {
      return NextResponse.json(
        { error: { message: 'Body must be JSON: { "values": { ... } }', code: 'invalid_body' } },
        { status: 400, headers },
      )
    }

    const idempotencyKey =
      request.headers.get('idempotency-key') ??
      (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null)

    const result = await submitLead({
      slug,
      values: body.values as Record<string, unknown>,
      ip,
      source: 'api',
      referrer: origin,
      idempotencyKey,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: { message: result.message, code: 'validation_failed', fields: result.fields } },
        { status: 422, headers },
      )
    }
    return NextResponse.json({ ok: true, duplicate: result.duplicate ?? false }, { status: 201, headers })
  } catch (error) {
    log.error('public form submit failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { message: 'Submission failed.', code: 'internal_error' } },
      { status: 500, headers: corsHeaders(origin, []) },
    )
  }
}
