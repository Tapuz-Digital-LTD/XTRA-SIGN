import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { getLandingSettings, saveLandingSettings, type LandingConfig } from '@/server/projects/landing'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json(await getLandingSettings(session, id))
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as
      | { enabled?: unknown; config?: unknown; notifyEmails?: unknown }
      | null

    const saved = await saveLandingSettings(session, id, {
      enabled: Boolean(body?.enabled),
      config: (body?.config ?? {}) as Partial<LandingConfig>,
      notifyEmails: Array.isArray(body?.notifyEmails)
        ? body.notifyEmails.filter((e): e is string => typeof e === 'string')
        : [],
    })
    return NextResponse.json(saved)
  } catch (error) {
    return templateFailure(error)
  }
}
