import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { createCompany, searchCompanies, type CompanyKind } from '@/server/companies/companies'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/** Companies of either kind, for the document filing picker. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const search = new URL(request.url).searchParams.get('q') ?? ''
    const companies = await searchCompanies(session, search)
    return NextResponse.json({ ok: true, companies })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Create a supplier or a customer. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const gate = await consume('userCreate', session.organizationId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נוצרו יותר מדי רשומות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const kind = body.kind === 'customer' ? 'customer' : body.kind === 'supplier' ? 'supplier' : null
    if (!kind) return NextResponse.json({ error: { message: 'סוג לא תקין.' } }, { status: 400 })

    const result = await createCompany({
      session,
      kind: kind as CompanyKind,
      data: {
        name: String(body.name ?? ''),
        taxId: str(body.taxId),
        contactName: str(body.contactName),
        contactPhone: str(body.contactPhone),
        contactEmail: str(body.contactEmail),
        notes: str(body.notes),
        crmRecordId: str(body.crmRecordId),
      },
    })

    return result.ok
      ? NextResponse.json({ ok: true, id: result.id })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return handle(error)
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

function handle(error: unknown) {
  if (error instanceof CsrfError) {
    return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
  }
  throw error
}
