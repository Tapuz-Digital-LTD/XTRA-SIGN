import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { importCrmDocuments, listCrmDocuments } from '@/server/crm/import-documents'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'

/** GET: the CRM files on this company's record. Read-only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const result = await listCrmDocuments({ session, companyId: id })
    return result.ok
      ? NextResponse.json({ ok: true, files: result.files })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return handle(error)
  }
}

/** POST: import the chosen files. Nothing is imported automatically. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'יובאו יותר מדי מסמכים. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { fileIds?: unknown } | null
    const fileIds = Array.isArray(body?.fileIds)
      ? (body!.fileIds.filter((f) => typeof f === 'string') as string[]).slice(0, 25)
      : []

    const result = await importCrmDocuments({
      session,
      companyId: id,
      fileIds,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return result.ok
      ? NextResponse.json({ ok: true, imported: result.imported, skipped: result.skipped, failed: result.failed })
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
