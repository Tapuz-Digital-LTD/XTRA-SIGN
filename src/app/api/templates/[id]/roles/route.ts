import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { assignTemplateRoles } from '@/server/templates/templates'

/** Which box answers which question of the self-service agreement. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { roles?: unknown } | null
    const roles = body?.roles && typeof body.roles === 'object' ? (body.roles as Record<string, unknown>) : null
    if (!roles) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const clean: Record<string, string | null> = {}
    for (const [fieldId, role] of Object.entries(roles)) {
      if (typeof fieldId !== 'string' || fieldId.length > 60) continue
      clean[fieldId] = typeof role === 'string' ? role : null
    }
    const result = await assignTemplateRoles({ session, templateId: id, roles: clean })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, mapped: result.mapped, missing: result.missing })
  } catch (error) {
    return templateFailure(error)
  }
}
