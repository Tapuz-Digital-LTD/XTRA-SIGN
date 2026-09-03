import { NextResponse } from 'next/server'
import { attachmentFilename } from '@/lib/content-disposition'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'
import { getPublicLanding } from '@/server/projects/landing'
import { getStorage } from '@/server/storage/blob'

/**
 * The public "הורד הסכם" download behind a project's landing page.
 *
 * The file comes from the project's landing config (a storage key), so the
 * campaign PDF can be replaced without touching any page. Reachable only
 * through an enabled landing slug, and only ever streams — no storage URL is
 * exposed.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params
    const ip = clientIp(request)

    const gate = await consume('leadSubmit', `agreement:${ip ?? 'unknown'}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'יותר מדי הורדות. נסו שוב בעוד מספר דקות.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const landing = await getPublicLanding(slug)
    if (!landing?.config.agreementFileKey) {
      return NextResponse.json({ error: { message: 'ההסכם אינו זמין להורדה.' } }, { status: 404 })
    }

    const bytes = await getStorage().get(landing.config.agreementFileKey)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentFilename(`הסכם - ${landing.projectName}.pdf`),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    log.error('public agreement download failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: { message: 'ההורדה נכשלה. נסו שוב.' } }, { status: 500 })
  }
}
