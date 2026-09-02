import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { searchCompanies, type CompanyKind } from '@/server/companies/companies'
import { buildExportWorkbook, type ExportRow } from '@/server/companies/excel'
import { withContactDetails } from '@/server/companies/companies'
import { listGroupCompanies } from '@/server/groups/groups'
import { templateFailure } from '@/server/http/template-errors'

/**
 * Exports what was asked for — a group, a kind, or an explicit selection —
 * and never the whole database because that was easier to write.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const url = new URL(request.url)
    const groupId = url.searchParams.get('group')
    const kindParam = url.searchParams.get('kind')
    const ids = url.searchParams.get('ids')?.split(',').filter(Boolean) ?? []

    let rows: ExportRow[]
    let title = 'ייצוא'

    if (groupId) {
      rows = await listGroupCompanies(session, groupId)
      title = 'קבוצה'
    } else {
      const kind: CompanyKind | undefined =
        kindParam === 'supplier' || kindParam === 'customer' ? kindParam : undefined
      const all = await searchCompanies(session, '', 1000, kind)
      const chosen = ids.length > 0 ? all.filter((c) => ids.includes(c.id)) : all
      // The picker query is deliberately thin; the export needs contact details.
      rows = await withContactDetails(session, chosen.map((c) => c.id))
      title = kind === 'customer' ? 'לקוחות' : kind === 'supplier' ? 'ספקים' : 'חברות'
    }

    const buffer = await buildExportWorkbook(rows, title)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="xtra-sign-${title}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return templateFailure(error)
  }
}
