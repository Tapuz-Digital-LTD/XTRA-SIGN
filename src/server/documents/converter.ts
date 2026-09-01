import { LIMITS, ProcessingError, type ProcessingFailure } from './limits'

/**
 * Client for the conversion service.
 *
 * The app never runs LibreOffice itself and never shells out to Docker. It
 * posts bytes to a service that lives in its own container with no network
 * route anywhere else, no credentials and no AWS access — so a document that
 * exploits LibreOffice lands somewhere with nothing worth reaching, and a
 * document that wedges it takes down one replaceable task rather than the app.
 *
 * One code path for local and production: docker-compose runs the same image
 * ECS will run. A dev-only shortcut here would be the one path never exercised
 * before it matters.
 */

export type PageGeometry = {
  page: number
  imageWidth: number
  imageHeight: number
  /** The page's own size in PDF points, measured — never assumed. */
  widthPt: number
  heightPt: number
}

export type ConversionResult = {
  pdf: Buffer
  pages: Buffer[]
  pageCount: number
  geometry: PageGeometry[]
}

export type ConversionInput = {
  buffer: Buffer
  kind: 'pdf' | 'doc' | 'docx'
}

/**
 * Wall-clock ceiling for one request, above the per-step timeouts inside the
 * service. Those assume the process is alive enough to enforce them; this one
 * does not, so a wedged container still releases the caller.
 */
const REQUEST_TIMEOUT_MS = LIMITS.CONVERSION_TIMEOUT_MS + LIMITS.RENDER_TIMEOUT_MS + 15_000

const FAILURES = new Set<ProcessingFailure>([
  'timeout',
  'too_many_pages',
  'output_too_large',
  'conversion_failed',
  'unreadable',
])

type ConverterResponse = {
  ok: boolean
  failure?: string
  pages?: number
  pdf?: string
  images?: string[]
  pageInfo?: {
    page: number
    imageWidth: number | null
    imageHeight: number | null
    widthPt: number | null
    heightPt: number | null
  }[]
}

export function converterUrl(): string {
  return (process.env.CONVERTER_URL ?? 'http://localhost:8090').replace(/\/+$/, '')
}

/** Liveness of the conversion service, for the readiness endpoint. */
export async function converterIsReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${converterUrl()}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function convertDocument(input: ConversionInput): Promise<ConversionResult> {
  let response: Response
  try {
    response = await fetch(`${converterUrl()}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Document-Kind': input.kind,
      },
      body: new Uint8Array(input.buffer),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // A timeout here is the outer ceiling firing, which is a timeout as far as
    // the user is concerned. Anything else means the service is unreachable.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new ProcessingError(timedOut ? 'timeout' : 'conversion_failed')
  }

  if (response.status === 413) throw new ProcessingError('output_too_large')

  let parsed: ConverterResponse
  try {
    parsed = (await response.json()) as ConverterResponse
  } catch {
    throw new ProcessingError('conversion_failed')
  }

  if (!parsed.ok) {
    const failure = FAILURES.has(parsed.failure as ProcessingFailure)
      ? (parsed.failure as ProcessingFailure)
      : 'conversion_failed'
    throw new ProcessingError(failure)
  }

  if (!parsed.pdf || !parsed.images?.length) throw new ProcessingError('unreadable')

  const pdf = Buffer.from(parsed.pdf, 'base64')
  if (pdf.length > LIMITS.MAX_RENDERED_BYTES) throw new ProcessingError('output_too_large')

  const pages = parsed.images.map((image) => Buffer.from(image, 'base64'))
  for (const page of pages) {
    if (page.length > LIMITS.MAX_PAGE_IMAGE_BYTES) throw new ProcessingError('output_too_large')
  }

  // A page whose geometry could not be measured is refused rather than
  // defaulted: a guessed page size puts every field on it in the wrong place.
  const geometry: PageGeometry[] = []
  for (const info of parsed.pageInfo ?? []) {
    if (!info.imageWidth || !info.imageHeight || !info.widthPt || !info.heightPt) {
      throw new ProcessingError('unreadable')
    }
    geometry.push({
      page: info.page,
      imageWidth: info.imageWidth,
      imageHeight: info.imageHeight,
      widthPt: info.widthPt,
      heightPt: info.heightPt,
    })
  }
  if (geometry.length !== pages.length) throw new ProcessingError('unreadable')

  return { pdf, pages, pageCount: parsed.pages ?? pages.length, geometry }
}
