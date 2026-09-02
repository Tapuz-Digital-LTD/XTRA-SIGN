import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { searchCompanies, type CompanyKind } from '@/server/companies/companies'
import { linkExistingCrmRecord, objectTypeFor, registerCompany } from '@/server/companies/registration'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/** Companies of either kind, for the document filing picker. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const url = new URL(request.url)
    const search = url.searchParams.get('q') ?? ''
    const kindParam = url.searchParams.get('kind')
    const kind = kindParam === 'supplier' || kindParam === 'customer' ? kindParam : undefined
    const companies = await searchCompanies(session, search, 20, kind)
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

    const data = {
      name: String(body.name ?? ''),
      taxId: str(body.taxId),
      contactName: str(body.contactName),
      contactPhone: str(body.contactPhone),
      contactEmail: str(body.contactEmail),
      notes: str(body.notes),
      // Never taken from the client as a free field: a CRM id is either
      // assigned by a create we made or chosen from a match we found.
      crmRecordId: null,
    }

    // "Link this existing Fireberry record" — the id was offered by our own
    // duplicate search, so it is checked against the CRM object we searched.
    const linkTo = str(body.linkCrmRecordId)
    if (linkTo) {
      const linked = await linkExistingCrmRecord({
        session,
        kind: kind as CompanyKind,
        data,
        crmRecordId: linkTo,
        crmObjectType: objectTypeFor(kind as CompanyKind),
      })
      return linked.ok
        ? NextResponse.json(linked)
        : NextResponse.json({ error: { message: linked.message, fields: 'fields' in linked ? linked.fields : undefined } }, { status: 400 })
    }

    const result = await registerCompany({
      session,
      kind: kind as CompanyKind,
      data,
      target: body.target === 'crm' ? 'crm' : 'local',
    })

    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: { message: result.message, fields: 'fields' in result ? result.fields : undefined } }, { status: 400 })
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
