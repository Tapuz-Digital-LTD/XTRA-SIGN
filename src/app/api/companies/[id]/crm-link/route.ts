import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'
import { linkExistingCrmRecord, registerCompany } from '@/server/companies/registration'
import { findCrmMatches } from '@/server/crm/company-registration'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/**
 * Retries connecting an existing local company to Fireberry.
 *
 * The point is that a failed CRM creation leaves a real local company, and the
 * retry must attach to *that* one rather than making a second. Duplicate
 * detection runs again first, because the earlier attempt may well have created
 * the record before failing on the response.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const company = await getCompany(session, id)
    if (!company) return NextResponse.json({ error: { message: 'החברה לא נמצאה.' } }, { status: 404 })
    if (company.crmRecordId) return NextResponse.json({ ok: true, outcome: 'created_and_linked', id: company.id })

    const body = (await request.json().catch(() => null)) as { linkCrmRecordId?: unknown } | null
    const data = {
      name: company.name,
      taxId: company.taxId,
      contactName: company.contactName,
      contactPhone: company.contactPhone,
      contactEmail: company.contactEmail,
      notes: null,
      crmRecordId: null,
    }

    const chosen = typeof body?.linkCrmRecordId === 'string' ? body.linkCrmRecordId : null
    if (chosen) {
      const linked = await linkExistingCrmRecord({
        session,
        kind: company.kind,
        data,
        crmRecordId: chosen,
        crmObjectType: company.kind === 'customer' ? 1 : 1000,
        companyId: company.id,
      })
      return linked.ok
        ? NextResponse.json(linked)
        : NextResponse.json({ error: { message: linked.message } }, { status: 400 })
    }

    let matches
    try {
      matches = await findCrmMatches(company.kind, data)
    } catch {
      return NextResponse.json(
        { error: { message: 'לא הצלחנו לבדוק אם החברה כבר קיימת ב-Fireberry. נסו שוב.' } },
        { status: 502 },
      )
    }
    if (matches.length > 0) return NextResponse.json({ ok: true, outcome: 'duplicates', matches })

    // No match: create it, and attach to the company that already exists here.
    const created = await registerCompany({ session, kind: company.kind, data, target: 'crm' })
    if (!created.ok) return NextResponse.json({ error: { message: created.message } }, { status: 400 })
    if (created.outcome === 'created_and_linked') {
      // registerCompany made a fresh local row; move the link onto the original
      // and drop the extra, so a retry never leaves two companies behind.
      const { getDb, schema } = await import('@/server/db')
      const { and, eq } = await import('drizzle-orm')
      const db = getDb()
      const [fresh] = await db.select().from(schema.companies).where(eq(schema.companies.id, created.id))
      if (fresh?.crmRecordId) {
        await db
          .update(schema.companies)
          .set({ crmRecordId: fresh.crmRecordId, crmObjectType: fresh.crmObjectType, source: 'crm', crmSyncedAt: new Date() })
          .where(and(eq(schema.companies.id, company.id), eq(schema.companies.organizationId, session.organizationId)))
        await db.delete(schema.companies).where(eq(schema.companies.id, created.id))
      }
      return NextResponse.json({ ok: true, outcome: 'created_and_linked', id: company.id })
    }
    return NextResponse.json(created)
  } catch (error) {
    return templateFailure(error)
  }
}
