import { NextResponse } from 'next/server'
import { attachmentFilename } from '@/lib/content-disposition'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { buildProjectWorkbook, parseProjectReportFilters } from '@/server/reports/project-report'

/** The project's registrations as a file — the same filters as the screen. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const url = new URL(request.url)
    const filters = parseProjectReportFilters({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      source: url.searchParams.get('source') ?? undefined,
      range: url.searchParams.get('range') ?? undefined,
    })
    const workbook = await buildProjectWorkbook(session, id, filters)
    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentFilename('project-registrations.xlsx'),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return templateFailure(error)
  }
}
