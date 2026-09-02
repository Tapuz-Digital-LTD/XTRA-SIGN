import { NextResponse } from 'next/server'
import { attachmentFilename } from '@/lib/content-disposition'
import { requireSession } from '@/server/auth/session'
import { applyImport, buildTemplateWorkbook, parseImport, type ImportRow } from '@/server/companies/excel'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

const MAX_BYTES = 5 * 1024 * 1024

/** The blank template, filled in and explained. */
export async function GET() {
  try {
    await requireSession()
    const buffer = await buildTemplateWorkbook()
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentFilename('xtra-sign-תבנית.xlsx'),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return templateFailure(error)
  }
}

/**
 * Two steps on purpose: a file upload returns a plan, and a separate call with
 * that plan writes. Nothing is created by dropping a file on the page.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: { message: 'לא נבחר קובץ.' } }, { status: 400 })
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: { message: 'הקובץ גדול מדי.' } }, { status: 400 })
      }
      const rows = await parseImport(session, Buffer.from(await file.arrayBuffer()))
      return NextResponse.json({ ok: true, rows })
    }

    const gate = await consume('userCreate', session.organizationId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נוצרו יותר מדי רשומות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { rows?: ImportRow[]; groupId?: unknown } | null
    if (!Array.isArray(body?.rows)) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const outcome = await applyImport({
      session,
      rows: body.rows,
      groupId: typeof body.groupId === 'string' ? body.groupId : null,
    })
    return NextResponse.json({ ok: true, ...outcome })
  } catch (error) {
    return templateFailure(error)
  }
}
