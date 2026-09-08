import { NextResponse } from 'next/server'
import { attachmentFilename } from '@/lib/content-disposition'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { buildReportWorkbook } from '@/server/reports/engine/export'
import { ReportError } from '@/server/reports/engine/query'
import { cleanDefinition } from '@/server/reports/engine/saved'
import { ENTITY_LABELS } from '@/server/reports/engine/types'

/** The whole report (or the chosen rows) as .xlsx. Rate-limited: a file is work for the database. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const gate = await consume('upload', `${session.userId}:export`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'יותר מדי ייצואים בזמן קצר. נסו שוב בעוד כמה דקות.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const definition = cleanDefinition(body)
    if (!definition) return NextResponse.json({ error: { message: 'בחרו מה להציג.' } }, { status: 400 })
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : undefined
    const extraColumns = Array.isArray(body?.extraColumns) ? body.extraColumns.filter((x): x is string => typeof x === 'string') : undefined
    const { buffer } = await buildReportWorkbook(session, { ...definition, ids, extraColumns })
    const stamp = new Date().toISOString().slice(0, 10)
    const name = `${ENTITY_LABELS[definition.entity].label} ${stamp}.xlsx`
    return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': attachmentFilename(name), 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ReportError) return NextResponse.json({ error: { message: error.message } }, { status: 400 })
    return templateFailure(error)
  }
}
