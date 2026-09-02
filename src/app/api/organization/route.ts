import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { getOrganizationProfile, updateOrganizationProfile } from '@/server/organization/profile'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ ok: true, profile: await getOrganizationProfile(session) })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

    // Read field by field: an unexpected key must not reach the update.
    const text = (key: string) => (typeof body?.[key] === 'string' ? (body[key] as string) : null)
    const result = await updateOrganizationProfile(session, {
      name: text('name') ?? undefined,
      legalName: text('legalName'),
      taxId: text('taxId'),
      address: text('address'),
      phone: text('phone'),
      email: text('email'),
      website: text('website'),
      logoUrl: text('logoUrl'),
      brandPrimary: text('brandPrimary'),
      brandAccent: text('brandAccent'),
      brandFont: text('brandFont'),
      footerText: text('footerText'),
    })

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
