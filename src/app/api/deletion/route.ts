import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { deleteEntity, getDeletionImpact, isDeletionMode, isEntityType, requestAdminDeletion } from '@/server/deletion/policy'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { clientIp } from '@/server/log'

/**
 * One door for removing anything: what would happen (GET), and doing it
 * (POST). The policy lives in the service; this only carries the answer.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const url = new URL(request.url)
    const type = url.searchParams.get('type')
    const id = url.searchParams.get('id')
    if (!isEntityType(type) || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }
    return NextResponse.json(await getDeletionImpact(session, type, id))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as { type?: unknown; id?: unknown; mode?: unknown; acknowledged?: unknown } | null
    const type = body?.type
    const id = body?.id
    if (!isEntityType(type) || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }
    const ip = clientIp(request)
    if (body?.mode === 'request') {
      await requestAdminDeletion(session, type, id, ip)
      return NextResponse.json({ ok: true, message: 'הבקשה נשלחה למנהלי המערכת.' })
    }
    if (!isDeletionMode(body?.mode)) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const result = await deleteEntity(session, type, id, { mode: body.mode, acknowledged: body.acknowledged === true, ip })
    if (!result.ok) return NextResponse.json({ error: { message: result.message, requiresAdmin: result.requiresAdmin ?? false } }, { status: result.requiresAdmin ? 403 : 400 })
    return NextResponse.json(result)
  } catch (error) {
    return failure(error)
  }
}

function failure(error: unknown) {
  const status = (error as { status?: number } | null)?.status
  if (status === 404) return NextResponse.json({ error: { message: 'הרשומה לא נמצאה.' } }, { status: 404 })
  return templateFailure(error)
}
