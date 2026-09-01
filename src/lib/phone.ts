/**
 * One canonical phone representation for the whole system.
 *
 * Ported from XtraGiftCard-NestApp `utilities/phone/phone.ts`, which solved the
 * real problem: the same mobile arrives spelled `050-123-4567`, `+972501234567`
 * and `0501234567`, and anything keyed on the raw string (OTP rate limits,
 * recipient lookup) silently splits into separate budgets per spelling.
 *
 * ONE DELIBERATE DIVERGENCE from the original: the prefix allowlist.
 * The gift-card store excludes 056/057/059 as a *business* decision about which
 * customers it serves. XTRA Sign serves whoever the sender chose to contract
 * with — a supplier on 057 must be able to receive a signing link. Blocking
 * them would be inheriting someone else's product decision as if it were a
 * technical constraint.
 */

/** Israeli mobile ranges, without the leading 0. Override per-deployment. */
export const ALLOWED_MOBILE_PREFIXES = (
  process.env.SIGN_ALLOWED_MOBILE_PREFIXES ?? '50,51,52,53,54,55,56,57,58,59'
)
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)

export const UNSUPPORTED_PHONE_MESSAGE =
  'מספר הטלפון אינו נתמך. יש להזין מספר סלולרי אחר.'

/** Digits in an Israeli mobile once the leading 0 is gone. */
const NATIONAL_DIGITS = 9

/**
 * E.164 (`+9725…`) for an accepted Israeli mobile, or null for anything else.
 *
 * Null rather than a best guess: a wrong normalisation silently matches the
 * wrong person, and for a signing link that means delivering someone's contract
 * to a stranger.
 */
export function normalizeIsraeliPhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null

  const trimmed = input.trim()
  const hadPlus = trimmed.startsWith('+')
  // Strip everything non-digit: spaces, hyphens, parens, and the RTL/LTR marks
  // Hebrew form fields quietly inject.
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (digits.startsWith('00972')) {
    digits = digits.slice(5)
  } else if (hadPlus && digits.startsWith('972')) {
    digits = digits.slice(3)
  } else if (digits.startsWith('972') && digits.length >= 12) {
    // `972…` without a plus is only a country code when the length says so.
    digits = digits.slice(3)
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  if (digits.length !== NATIONAL_DIGITS) return null
  if (!ALLOWED_MOBILE_PREFIXES.includes(digits.slice(0, 2))) return null

  return `+972${digits}`
}

/** National format (`05…`) — what the InforU payloads expect. */
export function toIsraeliNationalFormat(input: string | null | undefined): string | null {
  const e164 = normalizeIsraeliPhone(input)
  return e164 ? `0${e164.slice(4)}` : null
}

/** Masked for display in a signature certificate: `05X-XXX-1234`. */
export function maskPhone(input: string | null | undefined): string | null {
  const national = toIsraeliNationalFormat(input)
  return national ? `${national.slice(0, 3)}-XXX-${national.slice(-4)}` : null
}

/** Anything unreadable is NOT a match — equality on garbage is not identity. */
export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeIsraeliPhone(a)
  const right = normalizeIsraeliPhone(b)
  if (!left || !right) return false
  return left === right
}
