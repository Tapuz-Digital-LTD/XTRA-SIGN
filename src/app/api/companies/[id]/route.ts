import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { deleteCompany, updateCompany } from '@/server/companies/companies'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'

/** Update a company's details. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const result = await updateCompany({
      session,
      companyId: id,
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

/** Remove a company (soft). Its documents stay, filed under it. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const result = await deleteCompany({ session, companyId: id })
    return result.ok
      ? NextResponse.json({ ok: true })
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
