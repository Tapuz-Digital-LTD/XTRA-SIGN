import { log } from '@/server/log'
import type { CrmProvider, CrmUploadResult, CrmUploadTarget } from './types'

/**
 * Fireberry (formerly Powerlink).
 *
 * The file endpoint is the documented one:
 *   POST {base}/v2/record/{objectType}/{recordId}/files
 *   header  tokenid: <token>
 *   body    multipart/form-data, field "file"
 *
 * Auth is a single API token, kept in the environment and never in code. The
 * object numbers for our two company kinds are overridable per deployment, but
 * default to a standard Fireberry: account (customer) = 1, and the common
 * custom vendor object (supplier) = 1000.
 */

const DEFAULT_BASE = 'https://api.fireberry.com/api'

function objectFor(kind: 'supplier' | 'customer'): number {
  const env = kind === 'supplier' ? process.env.FIREBERRY_SUPPLIER_OBJECT : process.env.FIREBERRY_CUSTOMER_OBJECT
  const parsed = env ? Number.parseInt(env, 10) : NaN
  if (Number.isInteger(parsed)) return parsed
  return kind === 'supplier' ? 1000 : 1
}

export class FireberryProvider implements CrmProvider {
  readonly name = 'Fireberry'

  isConfigured(): boolean {
    return Boolean(process.env.FIREBERRY_API_TOKEN)
  }

  objectTypeForKind(kind: 'supplier' | 'customer'): number {
    return objectFor(kind)
  }

  /**
   * Reads records of one object type, a page at a time. Used by the one-way
   * import; never writes. Returns the raw rows keyed by Fireberry field name.
   */
  async queryRecords(input: {
    objectType: number
    fields: string[]
    pageNumber: number
    pageSize?: number
    /** Optional Fireberry filter, e.g. "(modifiedon > 2026-08-01)". */
    query?: string
    /** Field to sort by (ascending), e.g. "modifiedon" — used to advance a watermark. */
    sortBy?: string
  }): Promise<{ rows: Record<string, unknown>[]; isLastPage: boolean }> {
    const token = process.env.FIREBERRY_API_TOKEN
    if (!token) throw new Error('CRM is not configured')
    const base = (process.env.FIREBERRY_API_URL ?? DEFAULT_BASE).replace(/\/+$/, '')

    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { tokenid: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objecttype: input.objectType,
        page_size: input.pageSize ?? 100,
        page_number: input.pageNumber,
        fields: input.fields.join(','),
        ...(input.query ? { query: input.query } : {}),
        ...(input.sortBy ? { sort_by: input.sortBy, sort_type: 'asc' } : {}),
      }),
    })
    if (!response.ok) {
      throw new Error(`Fireberry query failed (${response.status})`)
    }
    const body = (await response.json()) as {
      success?: boolean
      data?: { Data?: Record<string, unknown>[]; IsLastPage?: boolean }
    }
    return {
      rows: body.data?.Data ?? [],
      isLastPage: body.data?.IsLastPage ?? true,
    }
  }

  /**
   * The files attached to one CRM record. Read-only.
   *
   * `GET /v3/record/{objectType}/{recordId}/files` returns `{id, url, size,
   * name}` per file — no mime or date, so the type is derived from the
   * extension. Entries whose url is null are skipped: they exist in the CRM but
   * expose nothing to download.
   */
  async listRecordFiles(input: {
    objectType: number
    recordId: string
  }): Promise<{ id: string; name: string; url: string; sizeMb: number | null }[]> {
    const token = process.env.FIREBERRY_API_TOKEN
    if (!token) throw new Error('CRM is not configured')
    const base = (process.env.FIREBERRY_API_URL ?? DEFAULT_BASE).replace(/\/+$/, '')

    const response = await fetch(
      `${base}/v3/record/${input.objectType}/${encodeURIComponent(input.recordId)}/files`,
      { headers: { tokenid: token } },
    )
    if (!response.ok) throw new Error(`Fireberry file list failed (${response.status})`)

    const body = (await response.json()) as { data?: { data?: unknown[] } }
    const rows = Array.isArray(body.data?.data) ? body.data!.data! : []

    return rows
      .map((r) => r as { id?: unknown; url?: unknown; name?: unknown; size?: unknown })
      .filter((r) => typeof r.id === 'string' && typeof r.url === 'string' && typeof r.name === 'string')
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        url: String(r.url),
        sizeMb: typeof r.size === 'number' ? r.size : null,
      }))
  }

  /**
   * Fetches one file's bytes.
   *
   * The URL comes back with the filename unencoded, so a Hebrew or spaced name
   * produces an invalid request unless the path is percent-encoded first.
   */
  async downloadFile(url: string, maxBytes: number): Promise<Buffer> {
    const parsed = new URL(url)
    const safe = `${parsed.origin}${parsed.pathname.split('/').map(encodeURIComponent).join('/')}${parsed.search}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(safe, { signal: controller.signal })
      if (!response.ok) throw new Error(`Fireberry file download failed (${response.status})`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > maxBytes) throw new Error('file too large')
      return buffer
    } finally {
      clearTimeout(timeout)
    }
  }

  async uploadFile(input: {
    target: CrmUploadTarget
    filename: string
    contentType: string
    bytes: Buffer
  }): Promise<CrmUploadResult> {
    const token = process.env.FIREBERRY_API_TOKEN
    if (!token) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

    const base = (process.env.FIREBERRY_API_URL ?? DEFAULT_BASE).replace(/\/+$/, '')
    const url = `${base}/v2/record/${input.target.objectType}/${encodeURIComponent(input.target.recordId)}/files`

    const form = new FormData()
    // A fresh ArrayBuffer copy: a Buffer's view may be a slice of a larger pool,
    // and Blob would otherwise capture the whole pool.
    const copy = new Uint8Array(input.bytes.byteLength)
    copy.set(input.bytes)
    form.append('file', new Blob([copy], { type: input.contentType }), input.filename)

    // The upload can be large and the CRM slow; bound it rather than hang a
    // function until its own timeout.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { tokenid: token },
        body: form,
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        log.warn('fireberry upload failed', {
          status: response.status,
          objectType: input.target.objectType,
          // The record id is not a secret, the token is never logged.
          recordId: input.target.recordId,
          body: body.slice(0, 300),
        })
        return {
          ok: false,
          message:
            response.status === 404
              ? 'הרשומה לא נמצאה ב-CRM. בדקו את מזהה הרשומה.'
              : response.status === 401 || response.status === 403
                ? 'החיבור ל-CRM נדחה. בדקו את הטוקן.'
                : 'העלאה ל-CRM נכשלה. נסו שוב.',
        }
      }

      return { ok: true }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      log.warn('fireberry upload error', { error: aborted ? 'timeout' : String(error) })
      return {
        ok: false,
        message: aborted ? 'העלאה ל-CRM ארכה זמן רב מדי. נסו שוב.' : 'העלאה ל-CRM נכשלה. נסו שוב.',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/** The active provider. One line to swap when a second CRM appears. */
export function getCrmProvider(): CrmProvider {
  return new FireberryProvider()
}
