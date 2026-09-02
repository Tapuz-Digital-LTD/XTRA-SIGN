import { lookup as dnsLookup } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'
import type { TemplateImage } from './html-sanitize'

/**
 * Fetching a template's images and embedding them in the HTML.
 *
 * Two reasons this exists, and both matter.
 *
 * It is what makes an imported template a *snapshot*. The images live on
 * Fireberry's CDN and, in several of the real templates, on third-party hosts.
 * A template that still pointed at those URLs would silently change when
 * someone replaced a file, and would break when one of them went away — which
 * is the opposite of what an imported agreement is for.
 *
 * It is also the one place where a URL chosen by someone else is fetched from
 * inside our network, so it is the SSRF boundary. Every address is resolved and
 * checked before a request is made: a template that asks for
 * 169.254.169.254 or for something on the private network gets nothing, and the
 * renderer that runs later has the network switched off entirely, so a URL that
 * survived this step still could not be reached.
 */

const MAX_ASSETS = 25
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

/** Only real pictures. A "logo" that answers with HTML is a redirect to something else. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'])

export type InlineResult = { html: string; failed: { src: string; reason: string }[] }

/**
 * Whether an address is one we are willing to fetch from.
 *
 * Blocks loopback, link-local (which is where the cloud metadata service
 * lives), the RFC1918 ranges, carrier-grade NAT and the IPv6 equivalents.
 */
function isPublicAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a >= 224) return false // multicast and reserved
    return true
  }
  if (version === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return false
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return false
    // ::ffff:127.0.0.1 and friends: judge the embedded v4 address.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicAddress(mapped[1])
    return true
  }
  return false
}

/** Resolves the host and refuses anything that is not a public address. */
async function isFetchable(url: URL): Promise<boolean> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false

  const host = url.hostname
  if (isIP(host)) return isPublicAddress(host)

  try {
    // `all` so a name that resolves to both a public and a private address is
    // judged on every answer, not just the first one.
    const addresses = await lookup(host, { all: true })
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address))
  } catch {
    return false
  }
}

/**
 * A dispatcher that refuses to connect to a non-public address.
 *
 * This is the enforcement point. `isFetchable` below is a cheap early
 * rejection that keeps obvious cases from opening a socket at all; this is what
 * makes the guarantee, because it sees the address the connection will use.
 */
const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, '', 0)
        const list = Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }]
        if (list.length === 0 || !list.every((entry) => isPublicAddress(entry.address))) {
          return callback(new Error('address is not publicly routable'), '', 0)
        }
        // Undici asks for every address when it wants to try them in turn, so
        // hand back the same shape it asked for — all of them already checked.
        if (options?.all) return callback(null, list as never, 0 as never)
        return callback(null, list[0].address, list[0].family)
      })
    },
  },
})

/** Reads a body, giving up the moment it exceeds the cap. */
async function readCapped(response: Response): Promise<Buffer | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // Stop at the cap rather than buffering the whole response and measuring
      // it afterwards: a Content-Length can be absent or simply untrue, and
      // "download it all, then decide" is how a 5 MB limit becomes an
      // out-of-memory crash.
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

async function fetchImage(src: string): Promise<{ ok: true; dataUri: string } | { ok: false; reason: string }> {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return { ok: false, reason: 'כתובת לא תקינה' }
  }

  if (!(await isFetchable(url))) return { ok: false, reason: 'כתובת שאינה ניתנת להורדה' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // No redirect following: a redirect would land on an address this function
    // never got to check.
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      // @ts-expect-error -- Node's fetch takes an undici dispatcher; the DOM lib types do not know it.
      dispatcher: guardedAgent,
    })
    if (!response.ok) return { ok: false, reason: `שגיאה ${response.status}` }

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!IMAGE_TYPES.has(type)) return { ok: false, reason: 'הקובץ אינו תמונה' }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, reason: 'התמונה גדולה מדי' }

    const bytes = await readCapped(response)
    if (!bytes) return { ok: false, reason: 'התמונה גדולה מדי' }

    return { ok: true, dataUri: `data:${type};base64,${bytes.toString('base64')}` }
  } catch {
    return { ok: false, reason: 'ההורדה נכשלה' }
  } finally {
    clearTimeout(timeout)
  }
}

/** Escapes a value for insertion into a double-quoted attribute. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Replaces each marked image's `src` with a data URI.
 *
 * A failure is reported and the image is left without a source rather than
 * aborting: one dead logo should not cost the operator the whole agreement, and
 * the import screen names what could not be fetched.
 */
export async function inlineAssets(html: string, images: TemplateImage[]): Promise<InlineResult> {
  const failed: { src: string; reason: string }[] = []
  const replacements = new Map<number, string>()
  // The cap is on requests attempted, not on images successfully embedded: a
  // template full of broken URLs must not become a way to make us issue an
  // unbounded number of outbound requests.
  let attempts = 0

  for (const image of images) {
    if (attempts >= MAX_ASSETS) {
      failed.push({ src: image.src, reason: 'יותר מדי תמונות בתבנית' })
      continue
    }
    attempts += 1
    const result = await fetchImage(image.src)
    if (result.ok) replacements.set(image.index, result.dataUri)
    else failed.push({ src: image.src, reason: result.reason })
  }

  // Rewrite by marker, so the substitution cannot be confused by a URL that
  // happens to appear in the document text.
  const out = html.replace(
    /<img([^>]*?)data-xtra-img="(\d+)"([^>]*?)>/gi,
    (whole, before: string, index: string, after: string) => {
      const dataUri = replacements.get(Number(index))
      const rest = `${before} ${after}`.replace(/\s*src="[^"]*"/i, '').trim()
      if (!dataUri) return `<img ${rest}>`
      return `<img src="${attr(dataUri)}" ${rest}>`
    },
  )

  return { html: out, failed }
}
