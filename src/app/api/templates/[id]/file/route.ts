import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { previewHeaders } from '@/server/documents/preview'
import { templateFailure } from '@/server/http/template-errors'
import { getStorage } from '@/server/storage/blob'
import { authorizeTemplateAccess } from '@/server/templates/templates'

/** The template's PDF, for viewing and for the field editor. Staff only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const template = await authorizeTemplateAccess(session, id)
    if (!template.sourceFileKey) {
      return NextResponse.json({ error: { message: 'לתבנית אין קובץ.' } }, { status: 404 })
    }
    const bytes = await getStorage().get(template.sourceFileKey)
    return new NextResponse(new Uint8Array(bytes), { headers: previewHeaders('application/pdf', `${template.name}.pdf`) })
  } catch (error) {
    return templateFailure(error)
  }
}
