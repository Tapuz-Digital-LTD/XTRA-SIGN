import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { crmObjectTypeFor, getCompany } from '@/server/companies/companies'
import { listBusinessDocuments } from '@/server/crm/business-documents'
import { importBusinessDocument } from '@/server/crm/import-business-document'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { templateFailure } from '@/server/http/template-errors'

/** The company's quotes and orders in Fireberry. Read-only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const company = await getCompany(session, id)
    if (!company?.crmRecordId) {
      return NextResponse.json({ ok: true, documents: [] })
    }

    const documents = await listBusinessDocuments({
      crmObjectType: crmObjectTypeFor(company),
      crmRecordId: company.crmRecordId,
    })
    return NextResponse.json({ ok: true, documents })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Brings one across as a document to be signed. */
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

    const body = (await request.json().catch(() => null)) as { recordId?: unknown; objectType?: unknown } | null
    if (typeof body?.recordId !== 'string' || typeof body?.objectType !== 'number') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await importBusinessDocument({
      session,
      companyId: id,
      crmObjectType: body.objectType,
      crmRecordId: body.recordId,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
