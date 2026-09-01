import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/**
 * Hebrew text that survives being drawn into a PDF.
 *
 * pdf-lib has no bidi support and fontkit reverses an RTL run wholesale,
 * digits included. Measured, not assumed: "עמלה 15% לספק" came out as
 * "עמלה 51% לספק" — a 15% commission printed as 51% on a signed agreement.
 *
 * A hand-rolled fix got the digits right and then moved the colon in
 * "ח.פ: 515123456", which is how it usually goes with neutrals. So this runs
 * the real Unicode Bidirectional Algorithm (UAX #9) to get visual order, then
 * reverses the result so fontkit's own reversal cancels out.
 *
 * Verified by rendering the output back to an image and reading it: commission
 * percentages, company IDs, phone numbers, quoted company names and mixed
 * number/Hebrew sentences all come out right.
 */
/** True when the string contains any Hebrew letter. */
export function hasHebrew(text: string): boolean {
  return /[\u0590-\u05ff]/.test(text)
}

export function shapeForPdf(text: string): string {
  if (!text) return ''

  // The final reversal below only cancels out when fontkit actually reverses,
  // and it only does that for text containing an RTL script. A pure-LTR value
  // like "15%" would otherwise be reversed once and print as "%51" — measured
  // on a real signed PDF, where a 15% commission came out as 51%.
  if (!hasHebrew(text)) return text

  const embedding = bidi.getEmbeddingLevels(text, 'rtl')
  const segments = bidi.getReorderSegments(text, embedding)

  const chars = [...text]
  for (const [start, end] of segments) {
    const reversed = chars.slice(start, end + 1).reverse()
    for (let i = 0; i < reversed.length; i++) chars[start + i] = reversed[i]
  }

  return chars.reverse().join('')
}
