import { NextResponse } from 'next/server'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'
import { submitLead } from '@/server/projects/landing'

/**
 * The public submission endpoint behind a project's joining form.
 *
 * Unauthenticated by design — the whole point is that a supplier who has
 * nothing but the link can fill it in. Defended accordingly: per-IP rate
 * limit, a honeypot field no person ever sees, and hard caps on every value
 * inside submitLead.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params
    const ip = clientIp(request)

    const gate = await consume('leadSubmit', `${ip ?? 'unknown'}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'התקבלו יותר מדי פניות. נסו שוב בעוד מספר דקות.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { values?: Record<string, unknown>; website?: unknown }
      | null

    // The honeypot: a hidden "website" input. People leave it empty; bots
    // helpfully fill it. A filled one gets a polite yes and no lead.
    if (typeof body?.website === 'string' && body.website.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    const result = await submitLead({ slug, values: body?.values ?? {}, ip })
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
