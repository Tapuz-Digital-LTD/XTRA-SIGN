import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { importCrmTemplates, listCrmTemplates } from '@/server/crm/import-templates'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'

/**
 * Importing Fireberry print templates.
 *
 * Reading is free; importing runs a headless browser per template, so it spends
 * the upload budget and is capped in the orchestration layer. Templates are
 * organization-wide, so nothing here takes an id from the client except the
 * CRM template ids to fetch — which are looked up against the CRM's own listing.
 */

export async function GET() {
  try {
    const session = await requireSession()
    const result = await listCrmTemplates(session)
    return result.ok
      ? NextResponse.json({ ok: true, templates: result.templates })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return handle(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'יובאו יותר מדי תבניות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { templateIds?: unknown } | null
    const templateIds = Array.isArray(body?.templateIds)
      ? (body!.templateIds.filter((t) => typeof t === 'string') as string[])
      : []

    const started = Date.now()
    const result = await importCrmTemplates({ session, templateIds })
    return result.ok
      ? NextResponse.json({
          ok: true,
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          elapsedMs: Date.now() - started,
        })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return handle(error)
  }
}

function handle(error: unknown) {
  if (error instanceof CsrfError) return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
  throw error
}
