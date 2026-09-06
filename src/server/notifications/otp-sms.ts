import { publicBaseUrl } from '@/server/http/public-url'

/**
 * The one-time-code SMS, in the shape phones understand.
 *
 * The human line first ("קוד הכניסה שלך … הוא: 123456"), then a blank line,
 * then the WebOTP line `@host #code` as the last line of the message — the
 * format the WebOTP specification binds a code to a domain with, so Chrome
 * on Android offers the code to the page that asked for it. iOS ignores that
 * line and reads the digits from the message, so both keep working. System-
 * controlled on purpose: a campaign may not reword this message.
 */
export function otpSmsText(prefix: string, code: string): string {
  const host = otpHost()
  return host ? `${prefix} ${code}\n\n@${host} #${code}` : `${prefix} ${code}`
}

function otpHost(): string | null {
  try {
    const url = new URL(publicBaseUrl())
    // A local dev server is not a domain a phone would bind to.
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null
    return url.host
  } catch {
    return null
  }
}
