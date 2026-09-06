import { NextResponse } from 'next/server'
import { requireAdmin, requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { publicBaseUrl } from '@/server/http/public-url'
import { brandFor } from '@/server/mail/brand'
import { isMailTemplateKey, renderSample } from '@/server/mail/catalog'

/** A template with sample data, as the HTML a mail client would get. Admins only. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    requireAdmin(session)
    const url = new URL(request.url)
    const key = url.searchParams.get('template')
    if (!isMailTemplateKey(key)) return NextResponse.json({ error: { message: 'תבנית לא מוכרת.' } }, { status: 400 })
    const brand = await brandFor({ organizationId: session.organizationId })
    const rendered = await renderSample(key, brand, publicBaseUrl())
    if (url.searchParams.get('format') === 'text') {
      return new NextResponse(rendered.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    return new NextResponse(rendered.html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'" },
    })
  } catch (error) {
    return templateFailure(error)
  }
}
