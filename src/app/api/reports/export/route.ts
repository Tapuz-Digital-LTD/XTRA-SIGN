import { NextResponse } from 'next/server'
import { attachmentFilename } from '@/lib/content-disposition'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { buildReportWorkbook, parseReportFilters } from '@/server/reports/reports'

/** The report as a file: the same filters, the same rows the KPIs counted. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const url = new URL(request.url)
    const filters = parseReportFilters({
      kind: url.searchParams.get('kind') ?? undefined,
      group: url.searchParams.get('group') ?? undefined,
      source: url.searchParams.get('source') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })

    const workbook = await buildReportWorkbook(session, filters)
    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentFilename('xtra-sign-report.xlsx'),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return templateFailure(error)
  }
}
