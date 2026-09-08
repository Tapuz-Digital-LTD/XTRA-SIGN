import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { fieldMeta } from '@/server/reports/engine/registry'
import { fieldsFor, isReportEntity } from '@/server/reports/engine/query'

/** The fields a report of this entity may show, filter and sort by — the allowlist, with labels. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const entity = new URL(request.url).searchParams.get('entity')
    if (!isReportEntity(entity)) return NextResponse.json({ error: { message: 'בחרו מה להציג.' } }, { status: 400 })
    const fields = await fieldsFor(session, entity)
    return NextResponse.json({ fields: fields.map(fieldMeta) })
  } catch (error) {
    return templateFailure(error)
  }
}
